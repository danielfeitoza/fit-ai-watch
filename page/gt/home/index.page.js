import * as hmUI from "@zos/ui";
import { getDeviceInfo } from "@zos/device";
import {
  pauseDropWristScreenOff,
  pausePalmScreenOff,
  resetDropWristScreenOff,
  resetPageBrightTime,
  resetPalmScreenOff,
  setPageBrightTime,
  setWakeUpRelaunch,
} from "@zos/display";
import { BasePage } from "@zeppos/zml/base-page";
import { log as Logger } from "@zos/utils";
import {
  STORAGE_KEYS,
  clearActiveProgressState,
  clearLinkedUserContext,
  clearUnlinkedStorage,
  ls_clear_training_state,
  ls_get,
  ls_set,
  migrateLegacyStorage,
} from "./storage";
import {
  UI_STATES,
  WEEKDAY_PT_BR,
  advanceProgress,
  buildTrainingState,
  formatClock,
  generateUuidV4,
  getElapsedSeconds,
  getProgressionAction,
  isIsoDateToday,
  getTodayDateString,
  resolveUserId,
} from "./training-state";

const logger = Logger.getLogger("fit-ai-watch");

const POLL_INTERVAL_MS = 4000;
const LIVE_TICK_MS = 1000;
const REQUEST_TIMEOUT_MS = 10000;
const PAIR_URL = "https://www.fitaiapp.cidadeladocodigo.com.br/parear";
const VALIDATION_ERROR_MESSAGE =
  'Nao foi possivel validar suas informacoes agora. Verifique sua conexao e toque em "Tentar novamente".';

const COLORS = {
  backgroundText: 0xffffff,
  secondaryText: 0xc9c9c9,
  mutedText: 0xb6c8dc,
  primaryBlue: 0x0e8feb,
  error: 0xff6b6b,
  warning: 0xffc46b,
  success: 0x1aa34a,
  successPressed: 0x14853c,
  neutral: 0x434343,
  neutralPressed: 0x333333,
  info: 0x1f7ae0,
  infoPressed: 0x1a63b4,
  debug: 0x2f2f2f,
  debugPressed: 0x242424,
};

const { width: DEVICE_WIDTH, height: DEVICE_HEIGHT } = getDeviceInfo();
const ROUND_RADIUS = Math.min(DEVICE_WIDTH, DEVICE_HEIGHT) / 2;
const CENTER_X = DEVICE_WIDTH / 2;
const CENTER_Y = DEVICE_HEIGHT / 2;
const BOTTOM_BUTTON_Y = DEVICE_HEIGHT - 72;
const BOTTOM_BUTTON_HEIGHT = 72;
const PAGE_BRIGHT_TIME_MS = 180000;

function getSafeLayout(yPosition, elementHeight = 0, horizontalPadding = 0) {
  const y = Number(yPosition || 0);
  const h = Math.max(0, Number(elementHeight || 0));
  const padding = Math.max(0, Number(horizontalPadding || 0));
  const criticalY = y < CENTER_Y ? y : y + h;
  const dy = Math.abs(criticalY - CENTER_Y);

  if (dy >= ROUND_RADIUS) {
    return { x: 0, w: 0 };
  }

  const dx = Math.sqrt(ROUND_RADIUS * ROUND_RADIUS - dy * dy);
  const left = Math.ceil(CENTER_X - dx + padding);
  const right = Math.floor(CENTER_X + dx - padding);
  const width = Math.max(0, right - left);

  return {
    x: Math.max(0, left),
    w: Math.min(DEVICE_WIDTH, width),
  };
}

function getSafeSquareLayout(yPosition, maxSize, horizontalPadding = 0) {
  const y = Math.max(0, Math.floor(Number(yPosition || 0)));
  const padding = Math.max(0, Number(horizontalPadding || 0));
  let size = Math.max(0, Math.floor(Number(maxSize || 0)));

  while (size > 0) {
    const top = getSafeLayout(y, 0, padding);
    const bottom = getSafeLayout(y + size, 0, padding);
    const safeWidth = Math.min(top.w, bottom.w);

    if (size <= safeWidth) {
      return {
        x: Math.floor((DEVICE_WIDTH - size) / 2),
        y,
        size,
      };
    }

    size -= 2;
  }

  return { x: 0, y, size: 0 };
}

function resolveDeviceName() {
  const info = getDeviceInfo() || {};
  const candidates = [
    info.deviceName,
    info.name,
    info.modelName,
    info.productName,
    info?.brand && info?.model ? `${info.brand} ${info.model}` : "",
  ];

  for (const name of candidates) {
    if (typeof name === "string" && name.trim()) {
      return name.trim();
    }
  }

  return "Amazfit";
}

function formatDebugValue(value, maxLength = 40) {
  const raw = value == null ? "" : String(value);
  if (raw.length <= maxLength) {
    return raw;
  }

  return `${raw.slice(0, maxLength - 3)}...`;
}

function isAuthoritativeUnlinked(result, linkedUserId) {
  return result?.status === 404 || (result?.status === 200 && linkedUserId === "__UNLINKED__");
}

function isLinkCheckFailure(result) {
  return Number(result?.status || 0) >= 500 || Number(result?.status || 0) === 0;
}

function withTimeout(promise, timeoutMs = REQUEST_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve({ status: 408, data: null, reason: "timeout" }), timeoutMs);
    }),
  ]);
}

Page(
  BasePage({
    onInit() {
      this.widgets = [];
      this.exerciseWidgets = {};
      this.pollTimer = null;
      this.liveTimer = null;
      this.isPairingFlow = false;
      this.isDestroyed = false;
      this.deviceCode = "";
      this.userId = "";
      this.qrCodeUrl = "";
      this.lastTodayPayload = null;
      this.activeSessionPayload = null;
      this.lastActiveResponse = null;
      this.lastTodayResponse = null;
      this.lastFinishDebug = null;
      this.currentScreen = "";
      this.feedbackMessage = "";
      this.pendingRetryAction = null;
      this.isProcessing = false;
      this.processingText = "Processando...";
      this.processingWidget = null;
      this.bottomButtonWidget = null;
      this.bottomButtonConfig = null;
      this.currentTrainingState = null;
      this.debugBackTo = UI_STATES.UNLINKED;
      logger.debug("home page init");
    },

    async build() {
      this.extendActiveScreenTime();
      this.renderBootScreen();
      try {
        await this.bootstrap();
      } catch (error) {
        logger.error(`Erro fatal no build: ${error?.message || error}`);
        this.renderFriendlyError(VALIDATION_ERROR_MESSAGE, () => this.bootstrap(), "Tentar novamente");
      }
    },

    async onResume() {
      this.extendActiveScreenTime();
      try {
        await this.handleResume();
      } catch (error) {
        logger.error(`Erro fatal no resume: ${error?.message || error}`);
        this.renderFriendlyError(VALIDATION_ERROR_MESSAGE, () => this.bootstrap(), "Tentar novamente");
      }
    },

    onPause() {
      this.stopLiveUpdates();
    },

    async bootstrap() {
      try {
        migrateLegacyStorage();
        this.deviceCode = ls_get(STORAGE_KEYS.DEVICE_CODE, "").trim();
        this.userId = ls_get(STORAGE_KEYS.USER_ID, "").trim();

        if (!this.deviceCode) {
          this.resetUnlinkedState();
          this.renderUnlinked();
          return;
        }

        const linkedUser = await this.fetchLinkedUserByDevice(this.deviceCode);
        const linkedUserId = this.cacheUserId(linkedUser?.data);

        if (isAuthoritativeUnlinked(linkedUser, linkedUserId)) {
          this.resetUnlinkedState();
          this.renderUnlinked();
          return;
        }

        if (isLinkCheckFailure(linkedUser)) {
          this.renderFriendlyError(VALIDATION_ERROR_MESSAGE, () => this.bootstrap(), "Tentar novamente");
          return;
        }

        const hydrated = await this.syncLinkedContext({
          allowCachedFallback: false,
        });
        if (!hydrated) {
          this.renderFriendlyError(VALIDATION_ERROR_MESSAGE, () => this.bootstrap(), "Tentar novamente");
        }
      } catch (error) {
        logger.error(`Erro no bootstrap: ${error?.message || error}`);
        this.renderFriendlyError(VALIDATION_ERROR_MESSAGE, () => this.bootstrap(), "Tentar novamente");
      }
    },

    cleanupWidgets() {
      this.stopLiveUpdates();

      for (const current of this.widgets) {
        try {
          hmUI.deleteWidget(current);
        } catch (_error) {
          // widget already removed
        }
      }

      this.widgets = [];
      this.exerciseWidgets = {};
      this.bottomButtonWidget = null;
      this.bottomButtonConfig = null;
    },

    getTrainingState(forceRefresh = false) {
      if (!forceRefresh && this.currentTrainingState) {
        return this.currentTrainingState;
      }

      this.currentTrainingState = buildTrainingState(this.activeSessionPayload || {});
      return this.currentTrainingState;
    },

    invalidateTrainingState() {
      this.currentTrainingState = null;
    },

    pushWidget(type, options) {
      const created = hmUI.createWidget(type, options);
      this.widgets.push(created);
      return created;
    },

    extendActiveScreenTime() {
      try {
        setWakeUpRelaunch({ relaunch: true });
        setPageBrightTime({ brightTime: PAGE_BRIGHT_TIME_MS });
        pauseDropWristScreenOff({ duration: PAGE_BRIGHT_TIME_MS });
        pausePalmScreenOff({ duration: PAGE_BRIGHT_TIME_MS });
      } catch (error) {
        logger.warn(`Falha ao estender tempo de tela: ${error?.message || error}`);
      }
    },

    resetActiveScreenTime() {
      try {
        resetPageBrightTime();
        resetDropWristScreenOff();
        resetPalmScreenOff();
      } catch (error) {
        logger.warn(`Falha ao restaurar tempo de tela: ${error?.message || error}`);
      }
    },

    async handleButtonAction(action, processingText = "Processando...") {
      if (this.isProcessing) {
        return;
      }

      this.extendActiveScreenTime();
      this.showProcessing(processingText);

      try {
        const result = typeof action === "function" ? action() : null;
        if (result && typeof result.then === "function") {
          await result;
        }
      } finally {
        this.hideProcessing();
      }
    },

    showProcessing(text = "Processando...") {
      this.isProcessing = true;
      this.processingText = text;

      if (this.bottomButtonWidget) {
        this.bottomButtonWidget.setProperty(hmUI.prop.MORE, {
          text,
          normal_color: COLORS.neutral,
          press_color: COLORS.neutralPressed,
        });
      }
    },

    refreshCurrentScreen() {
      if (this.isDestroyed) {
        return;
      }

      if (this.currentScreen === UI_STATES.EXERCISE) {
        this.renderExerciseScreen();
        return;
      }

      if (this.currentScreen === UI_STATES.MAIN) {
        this.renderMain(this.lastTodayPayload || {});
      }
    },

    hideProcessing() {
      this.isProcessing = false;
      this.processingText = "Processando...";

      if (this.bottomButtonWidget && this.bottomButtonConfig) {
        this.bottomButtonWidget.setProperty(hmUI.prop.MORE, {
          text: this.bottomButtonConfig.text,
          normal_color: this.bottomButtonConfig.color,
          press_color: this.bottomButtonConfig.pressColor,
        });
      }
    },

    setScreen(screenName) {
      this.currentScreen = screenName;
    },

    cacheUserId(payload) {
      const foundUserId = resolveUserId(payload);
      if (!foundUserId) {
        return "";
      }

      this.userId = foundUserId;
      ls_set(STORAGE_KEYS.USER_ID, foundUserId);
      return foundUserId;
    },

    resetUnlinkedState() {
      clearUnlinkedStorage();
      this.isPairingFlow = false;
      this.deviceCode = "";
      this.userId = "";
      this.lastTodayPayload = null;
      this.activeSessionPayload = null;
      this.feedbackMessage = "";
    },

    openStorageDebug(backTo) {
      this.debugBackTo = backTo || UI_STATES.UNLINKED;
      this.renderStorageDebugScreen();
    },

    closeStorageDebug() {
      if (this.debugBackTo === UI_STATES.MAIN) {
        this.renderMain(this.lastTodayPayload || {});
        return;
      }

      if (this.debugBackTo === UI_STATES.EXERCISE) {
        this.renderExerciseScreen();
        return;
      }

      if (this.debugBackTo === UI_STATES.QR) {
        this.renderQrCodeScreen();
        return;
      }

      this.renderUnlinked();
    },

    getCurrentFinishDebugPayload() {
      const workout = this.lastTodayPayload || this.activeSessionPayload || {};
      const sessionId = this.activeSessionPayload?.sessionId || "";
      const deviceCode = this.deviceCode || ls_get(STORAGE_KEYS.DEVICE_CODE, "").trim();

      return {
        sessionId,
        deviceCode,
        workoutPlanId: workout?.workoutPlanId || "",
        workoutDayId: workout?.workoutDayId || "",
        completedAt: new Date().toISOString(),
      };
    },

    renderStorageDebugScreen() {
      this.setScreen("debug");
      this.cleanupWidgets();

      const training = this.getTrainingState(true);
      const finishDebug = this.lastFinishDebug || {};
      const currentFinishDebug = this.getCurrentFinishDebugPayload();
      const lastActiveResponse = this.lastActiveResponse || {};
      const lastTodayResponse = this.lastTodayResponse || {};
      const headerFrame = getSafeLayout(26, 40, 16);
      let currentY = 82;
      const sections = [
        {
          title: "Vinculo",
          entries: [
            `deviceCode: ${formatDebugValue(ls_get(STORAGE_KEYS.DEVICE_CODE, ""))}`,
            `userId: ${formatDebugValue(ls_get(STORAGE_KEYS.USER_ID, ""))}`,
            `currentScreen: ${formatDebugValue(this.currentScreen || "")}`,
          ],
        },
        {
          title: "Sessao e Progresso",
          entries: [
            `activeSessionId: ${formatDebugValue(this.activeSessionPayload?.sessionId || "")}`,
            `startedAt: ${formatDebugValue(this.activeSessionPayload?.startedAt || "")}`,
            `completedAt: ${formatDebugValue(this.lastTodayPayload?.completedAt || "")}`,
            `currentExerciseId: ${formatDebugValue(ls_get(STORAGE_KEYS.CURRENT_EXERCISE_ID, ""))}`,
            `currentSetNumber: ${formatDebugValue(ls_get(STORAGE_KEYS.CURRENT_SET_NUMBER, ""))}`,
            `currentExercise: ${formatDebugValue(training.currentExercise?.name || "")}`,
          ],
        },
        {
          title: "Treino do Dia",
          entries: [
            `todayWorkoutDayId: ${formatDebugValue(this.lastTodayPayload?.workoutDayId || "")}`,
            `todayWorkoutName: ${formatDebugValue(this.lastTodayPayload?.workoutDayName || "")}`,
            `todayWorkoutPlanId: ${formatDebugValue(this.lastTodayPayload?.workoutPlanId || "")}`,
            `weekDay: ${formatDebugValue(this.lastTodayPayload?.weekDay || "")}`,
            `isRest: ${formatDebugValue(this.lastTodayPayload?.isRest || "")}`,
          ],
        },
        {
          title: "Payload Finish Atual",
          entries: [
            `sessionId: ${formatDebugValue(currentFinishDebug.sessionId, 120)}`,
            `deviceCode: ${formatDebugValue(currentFinishDebug.deviceCode, 120)}`,
            `workoutPlanId: ${formatDebugValue(currentFinishDebug.workoutPlanId, 120)}`,
            `workoutDayId: ${formatDebugValue(currentFinishDebug.workoutDayId, 120)}`,
            `completedAt: ${formatDebugValue(currentFinishDebug.completedAt, 120)}`,
          ],
        },
        {
          title: "Ultimo Finish Tentado",
          entries: [
            `sessionId: ${formatDebugValue(finishDebug.sessionId || "", 120)}`,
            `deviceCode: ${formatDebugValue(finishDebug.deviceCode || "", 120)}`,
            `workoutPlanId: ${formatDebugValue(finishDebug.workoutPlanId || "", 120)}`,
            `workoutDayId: ${formatDebugValue(finishDebug.workoutDayId || "", 120)}`,
            `completedAt: ${formatDebugValue(finishDebug.completedAt || "", 120)}`,
          ],
        },
        {
          title: "Ultimas Respostas API",
          entries: [
            `lastActiveResponse: ${formatDebugValue(JSON.stringify(lastActiveResponse), 220)}`,
            `lastTodayResponse: ${formatDebugValue(JSON.stringify(lastTodayResponse), 220)}`,
          ],
        },
      ];

      this.pushWidget(hmUI.widget.TEXT, {
        x: headerFrame.x,
        y: 26,
        w: headerFrame.w,
        h: 40,
        text: "Debug LocalStorage",
        color: COLORS.backgroundText,
        text_size: 24,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
      });

      sections.forEach((section) => {
        const sectionTitleFrame = getSafeLayout(currentY, 26, 14);
        this.pushWidget(hmUI.widget.TEXT, {
          x: sectionTitleFrame.x,
          y: currentY,
          w: sectionTitleFrame.w,
          h: 26,
          text: section.title,
          color: COLORS.warning,
          text_size: 18,
          align_h: hmUI.align.LEFT,
          align_v: hmUI.align.CENTER_V,
        });
        currentY += 30;

        section.entries.forEach((line) => {
          const estimatedLines = Math.max(1, Math.ceil(String(line).length / 24));
          const lineHeight = 18;
          const blockHeight = estimatedLines * lineHeight + 12;
          const frame = getSafeLayout(currentY, blockHeight, 14);
          this.pushWidget(hmUI.widget.TEXT, {
            x: frame.x,
            y: currentY,
            w: frame.w,
            h: blockHeight,
            text: line,
            color: 0xd4d4d4,
            text_size: 16,
            align_h: hmUI.align.LEFT,
            align_v: hmUI.align.TOP,
            text_style: hmUI.text_style.WRAP,
          });

          currentY += blockHeight + 8;
        });

        currentY += 6;
      });

      this.renderBottomButton({
        text: "Voltar",
        color: COLORS.neutral,
        pressColor: COLORS.neutralPressed,
        onClick: () => this.closeStorageDebug(),
      });
    },

    renderBootScreen() {
      this.setScreen("boot");
      this.cleanupWidgets();

      const frame = getSafeLayout(DEVICE_HEIGHT / 2 - 28, 56, 20);
      this.pushWidget(hmUI.widget.TEXT, {
        x: frame.x,
        y: DEVICE_HEIGHT / 2 - 28,
        w: frame.w,
        h: 56,
        text: "Carregando...",
        color: COLORS.backgroundText,
        text_size: 28,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
      });
    },

    renderTopDebugButton(backTo) {
      const frame = getSafeLayout(16, 44, 10);
      try {
        this.pushWidget(hmUI.widget.BUTTON, {
          x: frame.x,
          y: 16,
          w: frame.w,
          h: 44,
          radius: 0,
          normal_color: 0x000000,
          press_color: 0x111111,
          text: "FIT.AI",
          color: COLORS.backgroundText,
          text_size: 30,
          click_func: () => this.openStorageDebug(backTo),
        });
      } catch (error) {
        logger.warn(`Falha ao renderizar botao de debug: ${error?.message || error}`);
        this.pushWidget(hmUI.widget.TEXT, {
          x: frame.x,
          y: 16,
          w: frame.w,
          h: 44,
          text: "FIT.AI",
          color: COLORS.backgroundText,
          text_size: 30,
          align_h: hmUI.align.CENTER_H,
          align_v: hmUI.align.CENTER_V,
        });
      }

      return backTo;
    },

    renderBottomButton({ text, color, pressColor, onClick, processingText = "Processando..." }) {
      this.bottomButtonConfig = {
        text,
        color,
        pressColor,
        onClick,
        processingText,
      };

      this.bottomButtonWidget = this.pushWidget(hmUI.widget.BUTTON, {
        x: 0,
        y: BOTTOM_BUTTON_Y,
        w: DEVICE_WIDTH,
        h: BOTTOM_BUTTON_HEIGHT,
        radius: 0,
        normal_color: color,
        press_color: pressColor,
        text,
        text_size: 24,
        color: COLORS.backgroundText,
        click_func: () => {
          if (this.isProcessing) {
            return;
          }

          this.handleButtonAction(onClick, processingText);
        },
      });
    },

    updateBottomButton({ text, color, pressColor, onClick, processingText = "Processando..." }) {
      this.bottomButtonConfig = {
        text,
        color,
        pressColor,
        onClick,
        processingText,
      };

      if (!this.bottomButtonWidget) {
        this.renderBottomButton({ text, color, pressColor, onClick, processingText });
        return;
      }

      this.bottomButtonWidget.setProperty(hmUI.prop.MORE, {
        text,
        normal_color: color,
        press_color: pressColor,
      });
    },

    renderUnlinked(options = {}) {
      this.setScreen(UI_STATES.UNLINKED);
      this.cleanupWidgets();

      const showPollingError = !!options.showPollingError;
      const introHeight = 112;
      const buttonHeight = 60;
      const verticalGap = 20;
      const contentStartY = Math.floor((DEVICE_HEIGHT - (introHeight + verticalGap + buttonHeight)) / 2);
      const introFrame = getSafeLayout(contentStartY, introHeight, 16);

      this.pushWidget(hmUI.widget.TEXT, {
        x: introFrame.x,
        y: contentStartY,
        w: introFrame.w,
        h: introHeight,
        text: "Para vincular o smartwatch ao FIT.AI, escaneie o QR Code clicando no botao abaixo.",
        color: COLORS.backgroundText,
        text_size: 24,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.TOP,
        text_style: hmUI.text_style.WRAP,
      });

      const qrButtonY = contentStartY + introHeight + verticalGap;
      const qrButtonFrame = getSafeLayout(qrButtonY, buttonHeight, 12);
      this.pushWidget(hmUI.widget.BUTTON, {
        x: qrButtonFrame.x,
        y: qrButtonY,
        w: qrButtonFrame.w,
        h: buttonHeight,
        radius: 12,
        normal_color: COLORS.info,
        press_color: COLORS.infoPressed,
        text: "QR Code",
        text_size: 26,
        color: COLORS.backgroundText,
        click_func: () => this.handleButtonAction(() => this.onCreateQrCode(), "Gerando QR Code..."),
      });

      this.renderTopDebugButton(UI_STATES.UNLINKED);

      if (showPollingError) {
        const messageFrame = getSafeLayout(DEVICE_HEIGHT - 178, 48, 16);
        this.pushWidget(hmUI.widget.TEXT, {
          x: messageFrame.x,
          y: DEVICE_HEIGHT - 178,
          w: messageFrame.w,
          h: 48,
          text: "Ocorreu um erro. Tente novamente.",
          color: COLORS.error,
          text_size: 22,
          align_h: hmUI.align.CENTER_H,
          align_v: hmUI.align.CENTER_V,
        });

        this.renderBottomButton({
          text: "Recarregar",
          color: COLORS.neutral,
          pressColor: COLORS.neutralPressed,
          onClick: () => this.startPolling(),
        });
      }
    },

    renderQrCodeScreen() {
      this.setScreen(UI_STATES.QR);
      this.cleanupWidgets();

      const qrPreferredSize = Math.min(190, DEVICE_WIDTH - 120, DEVICE_HEIGHT - 180);
      const qrY = Math.floor((DEVICE_HEIGHT - qrPreferredSize) / 2);
      const qrLayout = getSafeSquareLayout(qrY, qrPreferredSize, 18);

      if (qrLayout.size > 0 && this.qrCodeUrl) {
        this.pushWidget(hmUI.widget.QRCODE, {
          x: qrLayout.x,
          y: qrLayout.y,
          w: qrLayout.size,
          h: qrLayout.size,
          content: this.qrCodeUrl,
        });
      }

      this.renderTopDebugButton(UI_STATES.QR);

      this.renderBottomButton({
        text: "Fechar",
        color: COLORS.neutral,
        pressColor: COLORS.neutralPressed,
        onClick: () => {
          this.isPairingFlow = false;
          this.stopPolling();
          this.renderUnlinked();
        },
      });
    },

    renderFriendlyError(message, onRetry, buttonText = "Recarregar") {
      this.setScreen(UI_STATES.ERROR);
      this.cleanupWidgets();
      this.pendingRetryAction = onRetry;
      this.renderTopDebugButton(UI_STATES.ERROR);

      const titleFrame = getSafeLayout(92, 50, 18);
      const bodyFrame = getSafeLayout(156, 132, 18);

      this.pushWidget(hmUI.widget.TEXT, {
        x: titleFrame.x,
        y: 92,
        w: titleFrame.w,
        h: 50,
        text: "Nao foi possivel continuar",
        color: COLORS.error,
        text_size: 24,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
      });

      this.pushWidget(hmUI.widget.TEXT, {
        x: bodyFrame.x,
        y: 156,
        w: bodyFrame.w,
        h: 132,
        text: message || "Tente novamente em alguns instantes.",
        color: COLORS.backgroundText,
        text_size: 22,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.TOP,
        text_style: hmUI.text_style.WRAP,
      });

      this.renderBottomButton({
        text: buttonText,
        color: COLORS.neutral,
        pressColor: COLORS.neutralPressed,
        onClick: () => {
          if (typeof this.pendingRetryAction === "function") {
            this.pendingRetryAction();
          }
        },
      });
    },

    renderMain(workout) {
      this.extendActiveScreenTime();
      this.setScreen(UI_STATES.MAIN);
      this.cleanupWidgets();
      this.lastTodayPayload = workout || {};
      const completedAt = this.getCompletedAtForToday(workout);
      const isWorkoutFinishedToday =
        this.feedbackMessage === "Treino finalizado com sucesso" || !!completedAt;

      this.renderTopDebugButton(UI_STATES.MAIN);

      if (workout?.isRest) {
        const titleFrame = getSafeLayout(62, 54, 16);
        const bodyFrame = getSafeLayout(132, 150, 18);

        this.pushWidget(hmUI.widget.TEXT, {
          x: titleFrame.x,
          y: 62,
          w: titleFrame.w,
          h: 54,
          text: WEEKDAY_PT_BR[workout?.weekDay] || "Dia de descanso",
          color: COLORS.backgroundText,
          text_size: 30,
          align_h: hmUI.align.CENTER_H,
          align_v: hmUI.align.CENTER_V,
        });

        this.pushWidget(hmUI.widget.TEXT, {
          x: bodyFrame.x,
          y: 132,
          w: bodyFrame.w,
          h: 150,
          text: "Hoje e dia de descanso. Aproveite para se recuperar para o proximo treino.",
          color: 0xd9d9d9,
          text_size: 24,
          align_h: hmUI.align.CENTER_H,
          align_v: hmUI.align.TOP,
          text_style: hmUI.text_style.WRAP,
        });

        return;
      }

      if (this.feedbackMessage) {
        const feedbackFrame = getSafeLayout(56, 52, 16);
        this.pushWidget(hmUI.widget.TEXT, {
          x: feedbackFrame.x,
          y: 56,
          w: feedbackFrame.w,
          h: 52,
          text: this.feedbackMessage,
          color: COLORS.success,
          text_size: 20,
          align_h: hmUI.align.CENTER_H,
          align_v: hmUI.align.CENTER_V,
        });
      }

      const titleFrame = getSafeLayout(110, 60, 16);
      const weekdayFrame = getSafeLayout(178, 42, 16);
      const descriptionFrame = getSafeLayout(236, 92, 18);

      this.pushWidget(hmUI.widget.TEXT, {
        x: titleFrame.x,
        y: 110,
        w: titleFrame.w,
        h: 60,
        text: workout?.workoutDayName || "Treino",
        color: COLORS.backgroundText,
        text_size: 30,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.WRAP,
      });

      this.pushWidget(hmUI.widget.TEXT, {
        x: weekdayFrame.x,
        y: 178,
        w: weekdayFrame.w,
        h: 42,
        text: WEEKDAY_PT_BR[workout?.weekDay] || "",
        color: COLORS.mutedText,
        text_size: 22,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
      });

      this.pushWidget(hmUI.widget.TEXT, {
        x: descriptionFrame.x,
        y: 236,
        w: descriptionFrame.w,
        h: 92,
        text: isWorkoutFinishedToday
          ? "Treino de hoje esta pago!"
          : "Para iniciar o treino de hoje, clique no botao abaixo.",
        color: COLORS.backgroundText,
        text_size: 24,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.TOP,
        text_style: hmUI.text_style.WRAP,
      });

      if (isWorkoutFinishedToday) {
        return;
      }

      this.renderBottomButton({
        text: "Iniciar treino",
        color: COLORS.success,
        pressColor: COLORS.successPressed,
        onClick: () => this.onStartWorkout(),
      });
    },

    renderExerciseScreen() {
      this.extendActiveScreenTime();

      const training = this.getTrainingState(true);
      const currentExercise = training.currentExercise;

      if (!currentExercise) {
        this.setScreen(UI_STATES.EXERCISE);
        this.cleanupWidgets();
        this.renderTopDebugButton(UI_STATES.EXERCISE);
        const emptyFrame = getSafeLayout(DEVICE_HEIGHT / 2 - 40, 80, 16);
        this.pushWidget(hmUI.widget.TEXT, {
          x: emptyFrame.x,
          y: DEVICE_HEIGHT / 2 - 40,
          w: emptyFrame.w,
          h: 80,
          text: "Nenhum exercicio encontrado.",
          color: COLORS.warning,
          text_size: 24,
          align_h: hmUI.align.CENTER_H,
          align_v: hmUI.align.CENTER_V,
        });
        return;
      }

      const viewModel = this.getExerciseViewModel(training);

      if (
        this.currentScreen === UI_STATES.EXERCISE &&
        this.exerciseWidgets.exerciseName &&
        this.exerciseWidgets.sets &&
        this.exerciseWidgets.helper &&
        this.exerciseWidgets.timerLabel &&
        this.exerciseWidgets.timerValue &&
        this.exerciseWidgets.timerValueBold
      ) {
        this.applyExerciseViewModel(viewModel);
        this.startLiveUpdates();
        return;
      }

      this.setScreen(UI_STATES.EXERCISE);
      this.cleanupWidgets();
      this.renderTopDebugButton(UI_STATES.EXERCISE);

      const exerciseFrame = getSafeLayout(72, 96, 18);
      const progressFrame = getSafeLayout(178, 42, 18);
      const helperFrame = getSafeLayout(248, 72, 18);
      const timerLabelFrame = getSafeLayout(312, 28, 18);
      const timerValueFrame = getSafeLayout(342, 42, 18);

      this.exerciseWidgets.exerciseName = this.pushWidget(hmUI.widget.TEXT, {
        x: exerciseFrame.x,
        y: 72,
        w: exerciseFrame.w,
        h: 96,
        text: viewModel.exerciseName,
        color: COLORS.backgroundText,
        text_size: 30,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.WRAP,
      });

      this.exerciseWidgets.sets = this.pushWidget(hmUI.widget.TEXT, {
        x: progressFrame.x,
        y: 178,
        w: progressFrame.w,
        h: 42,
        text: viewModel.seriesText,
        color: COLORS.backgroundText,
        text_size: 26,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
      });

      this.exerciseWidgets.helper = this.pushWidget(hmUI.widget.TEXT, {
        x: helperFrame.x,
        y: 248,
        w: helperFrame.w,
        h: 72,
        text: viewModel.helperMessage,
        color: COLORS.backgroundText,
        text_size: 20,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.TOP,
        text_style: hmUI.text_style.WRAP,
      });

      this.exerciseWidgets.timerLabel = this.pushWidget(hmUI.widget.TEXT, {
        x: timerLabelFrame.x,
        y: 312,
        w: timerLabelFrame.w,
        h: 28,
        text: viewModel.timerLabel,
        color: COLORS.secondaryText,
        text_size: 18,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
      });

      this.exerciseWidgets.timerValueBold = this.pushWidget(hmUI.widget.TEXT, {
        x: timerValueFrame.x + 1,
        y: 342,
        w: timerValueFrame.w,
        h: 42,
        text: viewModel.timerValue,
        color: viewModel.timerValueColor,
        text_size: 36,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
      });

      this.exerciseWidgets.timerValue = this.pushWidget(hmUI.widget.TEXT, {
        x: timerValueFrame.x,
        y: 342,
        w: timerValueFrame.w,
        h: 42,
        text: viewModel.timerValue,
        color: viewModel.timerValueColor,
        text_size: 36,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
      });

      this.renderBottomButton(viewModel.bottomButton);

      this.startLiveUpdates();
    },

    getExerciseViewModel(training) {
      const currentExercise = training.currentExercise;
      const action = getProgressionAction(training);
      const helperMessage = "Concluiu a serie atual? Inicie o descanso.";
      let bottomButton = {
        text: "Proxima Serie",
        color: COLORS.info,
        pressColor: COLORS.infoPressed,
        onClick: () => this.onProgressAfterRest(),
      };

      if (action.type === "finish") {
        bottomButton = {
          text: "Finalizar Treino",
          color: COLORS.success,
          pressColor: COLORS.successPressed,
          onClick: () => this.onFinishWorkout(),
        };
      }

      return {
        exerciseName: currentExercise?.name || "Exercicio",
        seriesText: `Serie ${training.setsCount} / ${training.totalSets}`,
        helperMessage,
        timerLabel: "Tempo total de treino efetivo",
        timerValue: formatClock(getElapsedSeconds(training.startedAt)),
        timerValueColor: COLORS.primaryBlue,
        bottomButton,
      };
    },

    applyExerciseViewModel(viewModel) {
      this.exerciseWidgets.exerciseName?.setProperty(hmUI.prop.MORE, {
        text: viewModel.exerciseName,
      });
      this.exerciseWidgets.sets?.setProperty(hmUI.prop.MORE, {
        text: viewModel.seriesText,
      });
      this.exerciseWidgets.helper?.setProperty(hmUI.prop.MORE, {
        text: viewModel.helperMessage,
      });
      this.exerciseWidgets.timerLabel?.setProperty(hmUI.prop.MORE, {
        text: viewModel.timerLabel,
      });
      this.exerciseWidgets.timerValue?.setProperty(hmUI.prop.MORE, {
        text: viewModel.timerValue,
      });
      this.exerciseWidgets.timerValueBold?.setProperty(hmUI.prop.MORE, {
        text: viewModel.timerValue,
      });
      this.exerciseWidgets.timerValue?.setProperty(hmUI.prop.COLOR, viewModel.timerValueColor);
      this.exerciseWidgets.timerValueBold?.setProperty(hmUI.prop.COLOR, viewModel.timerValueColor);
      this.updateBottomButton(viewModel.bottomButton);
    },

    updateExerciseLiveTexts() {
      if (this.currentScreen !== UI_STATES.EXERCISE) {
        return;
      }

      const training = this.getTrainingState(true);
      if (!training.currentExercise) {
        return;
      }

      this.exerciseWidgets.timerLabel?.setProperty(hmUI.prop.MORE, {
        text: "Tempo total de treino efetivo",
      });
      this.exerciseWidgets.timerValue?.setProperty(hmUI.prop.MORE, {
        text: formatClock(getElapsedSeconds(training.startedAt)),
      });
      this.exerciseWidgets.timerValueBold?.setProperty(hmUI.prop.MORE, {
        text: formatClock(getElapsedSeconds(training.startedAt)),
      });
      this.exerciseWidgets.timerValue?.setProperty(hmUI.prop.COLOR, COLORS.primaryBlue);
      this.exerciseWidgets.timerValueBold?.setProperty(hmUI.prop.COLOR, COLORS.primaryBlue);
      this.exerciseWidgets.sets?.setProperty(hmUI.prop.MORE, {
        text: `Serie ${training.setsCount} / ${training.totalSets}`,
      });
    },

    startLiveUpdates() {
      this.stopLiveUpdates();

      const tick = () => {
        if (this.isDestroyed || this.currentScreen !== UI_STATES.EXERCISE) {
          return;
        }

        this.updateExerciseLiveTexts();
        this.liveTimer = setTimeout(tick, LIVE_TICK_MS);
      };

      tick();
    },

    stopLiveUpdates() {
      if (this.liveTimer) {
        clearTimeout(this.liveTimer);
        this.liveTimer = null;
      }
    },

    async onCreateQrCode() {
      clearLinkedUserContext();
      this.isPairingFlow = true;
      this.userId = "";
      this.lastTodayPayload = null;
      this.deviceCode = generateUuidV4();

      const deviceName = resolveDeviceName();
      ls_set(STORAGE_KEYS.DEVICE_CODE, this.deviceCode);
      this.qrCodeUrl = `${PAIR_URL}?deviceCode=${encodeURIComponent(this.deviceCode)}&deviceName=${encodeURIComponent(deviceName)}`;

      this.renderQrCodeScreen();
      this.startPolling();
    },

    async fetchTodayStatus(deviceCode) {
      try {
        const result = await withTimeout(
          this.request({
            method: "watch.getToday",
            params: {
              date: getTodayDateString(),
              deviceCode,
            },
          })
        );
        this.lastTodayResponse = result || {};
        return result;
      } catch (error) {
        logger.error(`Erro ao consultar /watch/today: ${error?.message || error}`);
        this.lastTodayResponse = { status: 500, data: null, reason: "request_error" };
        return { status: 500, data: null };
      }
    },

    async fetchLinkedUserByDevice(deviceCode) {
      if (!deviceCode) {
        return { status: 400, data: { userId: 0 } };
      }

      try {
        return await withTimeout(
          this.request({
            method: "watch.getUserId",
            params: { deviceCode },
          })
        );
      } catch (error) {
        logger.error(`Erro ao consultar userId do device: ${error?.message || error}`);
        return { status: 500, data: { userId: 0 } };
      }
    },

    async fetchActiveSessionStatus() {
      if (!this.userId) {
        return { status: 400, data: { active: false } };
      }

      try {
        const result = await withTimeout(
          this.request({
            method: "watch.getActiveSession",
            params: {
              date: getTodayDateString(),
              userId: this.userId,
            },
          })
        );
        this.lastActiveResponse = result || {};
        return result;
      } catch (error) {
        logger.error(`Erro ao consultar sessao ativa: ${error?.message || error}`);
        this.lastActiveResponse = { status: 500, data: { active: false }, reason: "request_error" };
        return { status: 500, data: { active: false } };
      }
    },

    persistActiveSessionPayload(payload) {
      const sessionId =
        payload?.sessionId ||
        payload?.userWorkoutSessionId ||
        payload?.activeSessionId ||
        payload?.id ||
        "";
      this.activeSessionPayload = {
        ...(payload || {}),
        sessionId,
      };
      this.lastTodayPayload = {
        ...(payload || {}),
      };
      this.invalidateTrainingState();
    },

    getCompletedAtForToday(workout) {
      return isIsoDateToday(workout?.completedAt) ? workout?.completedAt : "";
    },

    clearActiveTrainingProgress() {
      clearActiveProgressState();
      this.activeSessionPayload = null;
      this.invalidateTrainingState();
    },

    async syncLinkedContext(options = {}) {
      try {
        const activeStatus = await this.fetchActiveSessionStatus();
        if (activeStatus?.status === 200 && activeStatus?.data?.active === true) {
          this.persistActiveSessionPayload(activeStatus.data);
          this.renderExerciseScreen();
          return true;
        }

        if (activeStatus?.status >= 500) {
          return false;
        }

        const todayStatus = await this.fetchTodayStatus(this.deviceCode);
        this.cacheUserId(todayStatus?.data);

        if (todayStatus?.status === 200) {
          this.activeSessionPayload = null;
          this.lastTodayPayload = todayStatus.data;

          if (this.getCompletedAtForToday(todayStatus.data)) {
            this.clearActiveTrainingProgress();
            this.renderMain(todayStatus.data);
            return true;
          }

          this.clearActiveTrainingProgress();
          this.renderMain(todayStatus.data);
          return true;
        }

        if (todayStatus?.status === 404) {
          this.activeSessionPayload = null;
          this.lastTodayPayload = {};
          this.clearActiveTrainingProgress();
          this.renderFriendlyError("Nenhum treino encontrado para hoje.", () => this.bootstrap());
          return true;
        }

        return false;
      } catch (error) {
        logger.error(`Erro no syncLinkedContext: ${error?.message || error}`);
        return false;
      }
    },

    startPolling() {
      this.stopPolling();

      const executePoll = async () => {
        if (this.isDestroyed || !this.deviceCode) {
          return;
        }

        const linkedUser = await this.fetchLinkedUserByDevice(this.deviceCode);
        const linkedUserId = this.cacheUserId(linkedUser?.data);

        if (isAuthoritativeUnlinked(linkedUser, linkedUserId)) {
          if (this.isPairingFlow) {
            this.pollTimer = setTimeout(executePoll, POLL_INTERVAL_MS);
            return;
          }

          this.resetUnlinkedState();
          this.renderUnlinked();
          return;
        }

        if (isLinkCheckFailure(linkedUser)) {
          this.pollTimer = setTimeout(executePoll, POLL_INTERVAL_MS);
          return;
        }

        if (linkedUser?.status === 200 && !linkedUserId) {
          logger.warn("Vinculo confirmado sem userId resolvido; prosseguindo com hidratacao por deviceCode.");
        }

        const synced = await this.syncLinkedContext({ allowCachedFallback: false });
        if (synced) {
          this.isPairingFlow = false;
          this.stopPolling();
          return;
        }

        this.pollTimer = setTimeout(executePoll, POLL_INTERVAL_MS);
      };

      executePoll();
    },

    stopPolling() {
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
    },

    async onStartWorkout() {
      let workout = this.lastTodayPayload || {};

      if (this.getCompletedAtForToday(workout)) {
        this.renderMain(workout);
        return;
      }

      if (!this.deviceCode) {
        this.deviceCode = ls_get(STORAGE_KEYS.DEVICE_CODE, "").trim();
      }

      const activeStatus = await this.fetchActiveSessionStatus();
      if (activeStatus?.status === 200 && activeStatus?.data?.active === true) {
        this.hideProcessing();
        this.persistActiveSessionPayload(activeStatus.data);
        this.renderExerciseScreen();
        return;
      }

      if (!workout?.workoutDayId) {
        const todayStatus = await this.fetchTodayStatus(this.deviceCode);
        if (todayStatus?.status === 200) {
          workout = todayStatus.data || {};
          this.lastTodayPayload = workout;
        }
      }

      if (!workout?.workoutDayId) {
        this.renderFriendlyError("Nenhum treino encontrado para hoje.", () => this.bootstrap());
        return;
      }

      try {
        const response = await this.request({
          method: "watch.startSession",
          params: {
            deviceCode: this.deviceCode,
            workoutPlanId: workout?.workoutPlanId,
            workoutDayId: workout?.workoutDayId,
          },
        });

        if (response?.status === 201 && response?.data?.completedAt) {
          this.clearActiveTrainingProgress();
          this.lastTodayPayload = {
            ...(workout || {}),
            completedAt: response.data.completedAt,
          };
          this.renderMain(this.lastTodayPayload);
          return;
        }

        if (response?.status === 201) {
          const activeAfterStart = await this.fetchActiveSessionStatus();
          if (activeAfterStart?.status === 200 && activeAfterStart?.data?.active === true) {
            this.hideProcessing();
            this.persistActiveSessionPayload(activeAfterStart.data);
            this.renderExerciseScreen();
            return;
          }
        }

        this.renderFriendlyError("Falha ao iniciar treino.", () => this.onStartWorkout());
      } catch (error) {
        logger.error(`Erro ao iniciar sessao: ${error?.message || error}`);
        this.renderFriendlyError("Falha ao iniciar treino.", () => this.onStartWorkout());
      }
    },

    onProgressAfterRest() {
      const training = this.getTrainingState(true);
      const action = advanceProgress(training);
      this.invalidateTrainingState();
      this.hideProcessing();
      this.currentScreen = "";

      if (action.type === "finish") {
        this.renderExerciseScreen();
        return;
      }

      this.renderExerciseScreen();
    },

    async onFinishWorkout() {
      const sessionId = this.activeSessionPayload?.sessionId || "";
      const workout = this.lastTodayPayload || this.activeSessionPayload || {};

      if (!this.deviceCode) {
        this.deviceCode = ls_get(STORAGE_KEYS.DEVICE_CODE, "").trim();
      }

      if (!sessionId) {
        this.renderFriendlyError("Sessao ativa nao encontrada para finalizar.", () => this.renderExerciseScreen());
        return;
      }

      try {
        const finishPayload = {
          sessionId,
          deviceCode: this.deviceCode,
          workoutPlanId: workout?.workoutPlanId || "",
          workoutDayId: workout?.workoutDayId || "",
          completedAt: new Date().toISOString(),
        };
        this.lastFinishDebug = finishPayload;

        const response = await this.request({
          method: "watch.finishSession",
          params: {
            sessionId: finishPayload.sessionId,
            deviceCode: finishPayload.deviceCode,
            workoutPlanId: finishPayload.workoutPlanId,
            workoutDayId: finishPayload.workoutDayId,
            completedAt: finishPayload.completedAt,
          },
        });

        if (response?.status === 200 || response?.status === 204) {
          ls_clear_training_state();
          this.feedbackMessage = "Treino finalizado com sucesso";
          this.activeSessionPayload = null;
          this.lastTodayPayload = {
            ...(workout || {}),
            completedAt: finishPayload.completedAt,
          };
          this.renderMain(this.lastTodayPayload);
          return;
        }

        this.renderFriendlyError("Falha ao finalizar treino.", () => this.onFinishWorkout());
      } catch (error) {
        logger.error(`Erro ao finalizar treino: ${error?.message || error}`);
        this.renderFriendlyError("Falha ao finalizar treino.", () => this.onFinishWorkout());
      }
    },

    async handleResume() {
      if (this.isDestroyed) {
        return;
      }

      if (this.currentScreen === UI_STATES.EXERCISE) {
        this.renderBootScreen();
        const synced = await this.syncLinkedContext({ allowCachedFallback: false });
        if (!synced) {
          this.renderFriendlyError(VALIDATION_ERROR_MESSAGE, () => this.bootstrap(), "Tentar novamente");
        }
        return;
      }

      this.renderBootScreen();
      const synced = await this.syncLinkedContext({ allowCachedFallback: false });
      if (!synced) {
        this.renderFriendlyError(VALIDATION_ERROR_MESSAGE, () => this.bootstrap(), "Tentar novamente");
      }
    },

    onDestroy() {
      this.isDestroyed = true;
      this.invalidateTrainingState();
      this.resetActiveScreenTime();
      this.stopPolling();
      this.stopLiveUpdates();
      this.cleanupWidgets();
      logger.debug("home page destroy");
    },
  })
);

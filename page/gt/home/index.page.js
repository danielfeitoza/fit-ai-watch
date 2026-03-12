import * as hmUI from "@zos/ui";
import { getDeviceInfo } from "@zos/device";
import { set as setAlarm, cancel as cancelAlarm } from "@zos/alarm";
import {
  pauseDropWristScreenOff,
  pausePalmScreenOff,
  resetDropWristScreenOff,
  resetPageBrightTime,
  resetPalmScreenOff,
  setPageBrightTime,
  setWakeUpRelaunch,
} from "@zos/display";
import { showToast } from "@zos/interaction";
import { Vibrator } from "@zos/sensor";
import { BasePage } from "@zeppos/zml/base-page";
import { log as Logger } from "@zos/utils";
import {
  STORAGE_KEYS,
  clearActiveProgressState,
  clearLinkedUserContext,
  clearTodayWorkoutState,
  clearUnlinkedStorage,
  getActiveSessionSnapshot,
  ls_clear_training_state,
  ls_get,
  ls_remove,
  ls_set,
  migrateLegacyStorage,
} from "./storage";
import {
  UI_STATES,
  WEEKDAY_PT_BR,
  advanceProgress,
  clearRestState,
  formatClock,
  generateUuidV4,
  getDateStringFromIso,
  getElapsedSeconds,
  getProgressionAction,
  getRemainingRestSeconds,
  isIsoDateToday,
  getTodayDateString,
  persistRestState,
  persistSessionIdentifiers,
  persistWorkoutPayload,
  readTrainingState,
  resetProgressForSession,
  resolveUserId,
  sortExercises,
} from "./training-state";

const logger = Logger.getLogger("fit-ai-watch");

const POLL_INTERVAL_MS = 4000;
const LIVE_TICK_MS = 1000;
const PAIR_URL = "https://www.fitaiapp.cidadeladocodigo.com.br/parear";

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

function hasOwn(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function buildRestFinishedMessage(actionType) {
  if (actionType === "next-set") {
    return "A hora do descanso acabou";
  }

  if (actionType === "next-exercise") {
    return "A hora do descanso acabou";
  }

  return "Treino concluido. Finalize a sessao.";
}

function isAuthoritativeUnlinked(result, linkedUserId) {
  return result?.status === 404 || (result?.status === 200 && !linkedUserId);
}

function isLinkCheckFailure(result) {
  return Number(result?.status || 0) >= 500 || Number(result?.status || 0) === 0;
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
      await this.bootstrap();
    },

    async onResume() {
      this.extendActiveScreenTime();
      await this.handleResume();
    },

    onPause() {
      this.stopLiveUpdates();
    },

    async bootstrap() {
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
        this.renderFriendlyError(
          "Houve um erro ao validar o vinculo do smartwatch. Deseja tentar novamente?",
          () => this.bootstrap()
        );
        return;
      }

      const hydrated = await this.syncLinkedContext({
        allowCachedFallback: false,
      });
      if (!hydrated) {
        this.renderFriendlyError(
          "Houve um erro durante a validacao do treino de hoje. Deseja tentar novamente?",
          () => this.bootstrap()
        );
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

      this.currentTrainingState = readTrainingState();
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
        this.renderMain(this.lastTodayPayload || ls_get(STORAGE_KEYS.TODAY_WORKOUT, {}));
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
      ls_set(STORAGE_KEYS.LAST_UI_STATE, screenName);
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
      this.feedbackMessage = "";
    },

    openStorageDebug(backTo) {
      this.debugBackTo = backTo || UI_STATES.UNLINKED;
      this.renderStorageDebugScreen();
    },

    closeStorageDebug() {
      if (this.debugBackTo === UI_STATES.MAIN) {
        this.renderMain(this.lastTodayPayload || ls_get(STORAGE_KEYS.TODAY_WORKOUT, {}));
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

    renderStorageDebugScreen() {
      this.setScreen("debug");
      this.cleanupWidgets();

      const training = this.getTrainingState(true);
      const finishDebug = ls_get(STORAGE_KEYS.LAST_FINISH_DEBUG, {});
      const lastActiveResponse = ls_get(STORAGE_KEYS.LAST_ACTIVE_RESPONSE, {});
      const lastTodayResponse = ls_get(STORAGE_KEYS.LAST_TODAY_RESPONSE, {});
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
            `activeSessionId: ${formatDebugValue(ls_get(STORAGE_KEYS.ACTIVE_SESSION_ID, ""))}`,
            `activeSessionDate: ${formatDebugValue(ls_get(STORAGE_KEYS.ACTIVE_SESSION_DATE, ""))}`,
            `startedAt: ${formatDebugValue(ls_get(STORAGE_KEYS.STARTED_AT, ""))}`,
            `completedAt: ${formatDebugValue(ls_get(STORAGE_KEYS.COMPLETED_AT, ""))}`,
            `exerciseIndex: ${formatDebugValue(ls_get(STORAGE_KEYS.EXERCISE_INDEX, ""))}`,
            `setsCount: ${formatDebugValue(ls_get(STORAGE_KEYS.SETS_COUNT, ""))}`,
            `serieCompleted: ${formatDebugValue(ls_get(STORAGE_KEYS.SERIE_COMPLETED, ""))}`,
            `restRunning: ${formatDebugValue(ls_get(STORAGE_KEYS.REST_RUNNING, ""))}`,
            `restTargetAt: ${formatDebugValue(ls_get(STORAGE_KEYS.REST_TARGET_AT, ""))}`,
            `currentExercise: ${formatDebugValue(training.currentExercise?.name || "")}`,
          ],
        },
        {
          title: "Treino do Dia",
          entries: [
            `todayWorkoutDayId: ${formatDebugValue(ls_get(STORAGE_KEYS.WORKOUT_DAY_ID, ""))}`,
            `todayWorkoutName: ${formatDebugValue(ls_get(STORAGE_KEYS.WORKOUT_DAY_NAME, ""))}`,
            `todayWorkoutPlanId: ${formatDebugValue(ls_get(STORAGE_KEYS.WORKOUT_PLAN_ID, ""))}`,
            `weekDay: ${formatDebugValue(ls_get(STORAGE_KEYS.WEEK_DAY, ""))}`,
            `isRest: ${formatDebugValue(ls_get(STORAGE_KEYS.IS_REST, ""))}`,
          ],
        },
        {
          title: "Ultimas Respostas API",
          entries: [
            `lastActiveStatus: ${formatDebugValue(JSON.stringify(ls_get(STORAGE_KEYS.LAST_ACTIVE_STATUS, {})), 120)}`,
            `lastActiveResponse: ${formatDebugValue(JSON.stringify(lastActiveResponse), 220)}`,
            `lastTodayResponse: ${formatDebugValue(JSON.stringify(lastTodayResponse), 220)}`,
            `lastFinishDebug: ${formatDebugValue(JSON.stringify(finishDebug), 220)}`,
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
      this.pushWidget(hmUI.widget.TEXT, {
        x: frame.x,
        y: 16,
        w: frame.w,
        h: 44,
        text: "FIT.AI",
        color: COLORS.backgroundText,
        text_size: 52,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
      });

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
        normal_color: this.isProcessing ? COLORS.neutral : color,
        press_color: this.isProcessing ? COLORS.neutralPressed : pressColor,
        text: this.isProcessing ? this.processingText : text,
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
        text: this.isProcessing ? this.processingText : text,
        normal_color: this.isProcessing ? COLORS.neutral : color,
        press_color: this.isProcessing ? COLORS.neutralPressed : pressColor,
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

    renderFriendlyError(message, onRetry) {
      this.setScreen(UI_STATES.ERROR);
      this.cleanupWidgets();
      this.pendingRetryAction = onRetry;

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
        text: "Recarregar",
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
      this.ensureRestConclusionIfNeeded();

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
      const isRestFinished = !training.restRunning && !!training.restStartedAt;
      const isLastSeriesOfLastExercise =
        action.type === "finish" && training.serieCompleted !== true;
      const isReadyToFinishWorkout =
        action.type === "finish" && training.serieCompleted === true;

      let helperMessage = "Concluiu a serie atual? Inicie o descanso.";
      let bottomButton = {
        text: "Iniciar Descanso",
        color: COLORS.info,
        pressColor: COLORS.infoPressed,
        onClick: () => this.onStartRest(),
      };

      if (training.restRunning) {
        helperMessage = "Descansando...";
        bottomButton = {
          text: "Aguardando...",
          color: COLORS.neutral,
          pressColor: COLORS.neutralPressed,
          onClick: () => {},
        };
      } else if (isRestFinished) {
        helperMessage = buildRestFinishedMessage(action.type);
        bottomButton = {
          text: action.label,
          color: action.type === "finish" ? COLORS.success : COLORS.info,
          pressColor: action.type === "finish" ? COLORS.successPressed : COLORS.infoPressed,
          onClick: () => this.onProgressAfterRest(),
        };
      } else if (isLastSeriesOfLastExercise) {
        helperMessage = "Ultima serie em andamento.";
        bottomButton = {
          text: "Finalizar Exercicio",
          color: COLORS.success,
          pressColor: COLORS.successPressed,
          onClick: () => this.onCompleteLastSerie(),
        };
      } else if (isReadyToFinishWorkout) {
        helperMessage = "Ultima serie concluida.";
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

      if (training.restRunning) {
        const remainingRestSeconds = getRemainingRestSeconds(training.restTargetAt);
        if (remainingRestSeconds <= 0) {
          this.completeRest();
          this.renderExerciseScreen();
          return;
        }
        this.exerciseWidgets.timerLabel?.setProperty(hmUI.prop.MORE, {
          text: "Tempo total de treino efetivo",
        });
        const elapsed = formatClock(getElapsedSeconds(training.startedAt));
        this.exerciseWidgets.timerValue?.setProperty(hmUI.prop.MORE, {
          text: elapsed,
        });
        this.exerciseWidgets.timerValueBold?.setProperty(hmUI.prop.MORE, {
          text: elapsed,
        });
        this.exerciseWidgets.timerValue?.setProperty(hmUI.prop.COLOR, COLORS.primaryBlue);
        this.exerciseWidgets.timerValueBold?.setProperty(hmUI.prop.COLOR, COLORS.primaryBlue);
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
        const result = await this.request({
          method: "watch.getToday",
          params: {
            date: getTodayDateString(),
            deviceCode,
          },
        });
        ls_set(STORAGE_KEYS.LAST_TODAY_RESPONSE, result || {});
        return result;
      } catch (error) {
        logger.error(`Erro ao consultar /watch/today: ${error?.message || error}`);
        ls_set(STORAGE_KEYS.LAST_TODAY_RESPONSE, { status: 500, data: null, reason: "request_error" });
        return { status: 500, data: null };
      }
    },

    async fetchLinkedUserByDevice(deviceCode) {
      if (!deviceCode) {
        return { status: 400, data: { userId: 0 } };
      }

      try {
        return await this.request({
          method: "watch.getUserId",
          params: { deviceCode },
        });
      } catch (error) {
        logger.error(`Erro ao consultar userId do device: ${error?.message || error}`);
        return { status: 500, data: { userId: 0 } };
      }
    },

    async fetchActiveSessionStatus() {
      if (!this.userId) {
        ls_set(STORAGE_KEYS.LAST_ACTIVE_STATUS, { status: 400, active: false, reason: "missing_user_id" });
        return { status: 400, data: { active: false } };
      }

      try {
        const result = await this.request({
          method: "watch.getActiveSession",
          params: {
            date: getTodayDateString(),
            userId: this.userId,
          },
        });
        ls_set(STORAGE_KEYS.LAST_ACTIVE_RESPONSE, result || {});
        ls_set(STORAGE_KEYS.LAST_ACTIVE_STATUS, {
          status: Number(result?.status || 0),
          active: result?.data?.active === true,
        });
        return result;
      } catch (error) {
        logger.error(`Erro ao consultar sessao ativa: ${error?.message || error}`);
        ls_set(STORAGE_KEYS.LAST_ACTIVE_RESPONSE, { status: 500, data: { active: false }, reason: "request_error" });
        ls_set(STORAGE_KEYS.LAST_ACTIVE_STATUS, { status: 500, active: false, reason: "request_error" });
        return { status: 500, data: { active: false } };
      }
    },

    persistActiveSessionPayload(payload) {
      const mergedPayload = {
        ...(this.lastTodayPayload || ls_get(STORAGE_KEYS.TODAY_WORKOUT, {})),
        ...(payload || {}),
        isRest: false,
      };
      const today = getTodayDateString();

      persistWorkoutPayload(mergedPayload);
      this.syncCompletedAtStorageFromPayload(
        hasOwn(payload || {}, "completedAt") ? payload : mergedPayload
      );
      persistSessionIdentifiers({
        sessionId:
          payload?.userWorkoutSessionId ||
          payload?.activeSessionId ||
          payload?.sessionId ||
          payload?.id ||
          payload?.userWorkoutSession?.id ||
          payload?.userWorkoutSession?.userWorkoutSessionId ||
          getActiveSessionSnapshot().id,
        startedAt: payload?.startedAt || ls_get(STORAGE_KEYS.STARTED_AT, ""),
        activeDate: today,
      });

      if (ls_get(STORAGE_KEYS.EXERCISE_INDEX, "") === "") {
        ls_set(STORAGE_KEYS.EXERCISE_INDEX, 0);
      }
      if (ls_get(STORAGE_KEYS.SETS_COUNT, "") === "") {
        ls_set(STORAGE_KEYS.SETS_COUNT, 1);
      }
      if (ls_get(STORAGE_KEYS.SERIE_COMPLETED, "") === "") {
        ls_set(STORAGE_KEYS.SERIE_COMPLETED, false);
      }

      this.lastTodayPayload = mergedPayload;
    },

    shouldKeepCachedTraining() {
      const snapshot = getActiveSessionSnapshot();
      return snapshot.id && snapshot.date === getTodayDateString();
    },

    syncCompletedAtStorageFromPayload(payload) {
      if (!payload || !hasOwn(payload, "completedAt")) {
        return ls_get(STORAGE_KEYS.COMPLETED_AT, "");
      }

      const completedAt = payload?.completedAt;
      if (completedAt && isIsoDateToday(completedAt)) {
        ls_set(STORAGE_KEYS.COMPLETED_AT, completedAt);
        return completedAt;
      }

      ls_remove(STORAGE_KEYS.COMPLETED_AT);
      return "";
    },

    getCompletedAtForToday(workout) {
      const payloadCompletedAt = workout?.completedAt;
      const storedCompletedAt = ls_get(STORAGE_KEYS.COMPLETED_AT, "");

      if (isIsoDateToday(payloadCompletedAt)) {
        return payloadCompletedAt;
      }

      if (isIsoDateToday(storedCompletedAt)) {
        return storedCompletedAt;
      }

      return "";
    },

    clearActiveTrainingProgress() {
      clearActiveProgressState();
    },

    shouldResumeLocalActiveTraining(todayWorkout = {}) {
      const training = this.getTrainingState(true);
      const snapshot = getActiveSessionSnapshot();
      const localWorkoutDayId = training.workout?.workoutDayId || ls_get(STORAGE_KEYS.WORKOUT_DAY_ID, "");
      const remoteWorkoutDayId = todayWorkout?.workoutDayId || "";

      if (!snapshot.id || snapshot.date !== getTodayDateString()) {
        return false;
      }

      if (!training.startedAt || !Array.isArray(training.exercises) || training.exercises.length === 0) {
        return false;
      }

      if (this.getCompletedAtForToday(todayWorkout || training.workout)) {
        return false;
      }

      if (remoteWorkoutDayId && localWorkoutDayId && remoteWorkoutDayId !== localWorkoutDayId) {
        return false;
      }

      return true;
    },

    async syncLinkedContext(options = {}) {
      const allowCachedFallback = !!options.allowCachedFallback;
      const today = getTodayDateString();
      const snapshot = getActiveSessionSnapshot();
      const storedCompletedAt = ls_get(STORAGE_KEYS.COMPLETED_AT, "");

      if (storedCompletedAt && getDateStringFromIso(storedCompletedAt) !== today) {
        ls_remove(STORAGE_KEYS.COMPLETED_AT);
      }

      if (snapshot.id && snapshot.date && snapshot.date !== today) {
        ls_clear_training_state();
      }

      const activeStatus = await this.fetchActiveSessionStatus();
      this.syncCompletedAtStorageFromPayload(activeStatus?.data);
      if (activeStatus?.status === 200 && activeStatus?.data?.active === true) {
        this.persistActiveSessionPayload(activeStatus.data);
        this.renderExerciseScreen();
        return true;
      }

      if (activeStatus?.status >= 500 && !allowCachedFallback) {
        return false;
      }

      if (activeStatus?.status >= 500 && allowCachedFallback && this.shouldKeepCachedTraining()) {
        this.renderExerciseScreen();
        return true;
      }

      const todayStatus = await this.fetchTodayStatus(this.deviceCode);
      this.cacheUserId(todayStatus?.data);

      if (todayStatus?.status === 200) {
        persistWorkoutPayload(todayStatus.data);
        this.syncCompletedAtStorageFromPayload(todayStatus?.data);
        this.lastTodayPayload = todayStatus.data;

        if (this.getCompletedAtForToday(todayStatus.data)) {
          this.clearActiveTrainingProgress();
          this.renderMain(todayStatus.data);
          return true;
        }

        if (this.shouldResumeLocalActiveTraining(todayStatus.data)) {
          this.renderExerciseScreen();
          return true;
        }

        this.clearActiveTrainingProgress();

        this.renderMain(todayStatus.data);
        return true;
      }

      if (todayStatus?.status === 404) {
        ls_remove(STORAGE_KEYS.COMPLETED_AT);
        clearTodayWorkoutState();
        this.lastTodayPayload = {};
        this.clearActiveTrainingProgress();
        this.renderFriendlyError("Nenhum treino encontrado para hoje.", () => this.bootstrap());
        return true;
      }

      if (todayStatus?.status >= 500 && allowCachedFallback) {
        const cachedWorkout = ls_get(STORAGE_KEYS.TODAY_WORKOUT, {});
        const cachedExercises = sortExercises(ls_get(STORAGE_KEYS.TODAY_EXERCISES, []));

        if (cachedWorkout?.workoutDayId || cachedWorkout?.isRest || cachedExercises.length) {
          this.lastTodayPayload = cachedWorkout;
          this.renderMain(cachedWorkout);
          return true;
        }
      }

      return false;
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

        const synced = await this.syncLinkedContext({ allowCachedFallback: false });
        if (synced) {
          this.isPairingFlow = false;
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

    cancelRestAlarm() {
      const alarmId = Number(ls_get(STORAGE_KEYS.ALARM_ID, 0));
      if (alarmId > 0) {
        try {
          cancelAlarm(alarmId);
        } catch (error) {
          logger.warn(`Falha ao cancelar alarme ${alarmId}: ${error?.message || error}`);
        }
      }

      ls_remove(STORAGE_KEYS.ALARM_ID);
    },

    scheduleRestAlarm(targetAtIso) {
      this.cancelRestAlarm();

      const targetAtMs = new Date(targetAtIso).getTime();
      if (!targetAtMs || Number.isNaN(targetAtMs)) {
        return 0;
      }

      try {
        return Number(
          setAlarm({
            url: "service/timer_bg",
            time: Math.floor(targetAtMs / 1000),
            store: true,
            param: "rest-finished",
          }) || 0
        );
      } catch (error) {
        logger.warn(`Falha ao agendar alarme do descanso: ${error?.message || error}`);
        return 0;
      }
    },

    ensureRestConclusionIfNeeded() {
      const training = readTrainingState();
      if (!training.restRunning) {
        return;
      }

      if (getRemainingRestSeconds(training.restTargetAt) <= 0) {
        this.completeRest();
      }
    },

    completeRest() {
      const training = readTrainingState();
      if (!training.restRunning) {
        return;
      }

      this.cancelRestAlarm();
      clearRestState();
      ls_set(STORAGE_KEYS.REST_STARTED_AT, training.restStartedAt);

      try {
        const vibrator = new Vibrator();
        vibrator.start();
      } catch (error) {
        logger.warn(`Falha ao vibrar: ${error?.message || error}`);
      }

      const action = getProgressionAction(training);
      showToast({
        content: action.type === "next-set" ? "Descanso concluido" : "Hora de avancar",
      });
    },

    async onStartWorkout() {
      const workout = this.lastTodayPayload || ls_get(STORAGE_KEYS.TODAY_WORKOUT, {});

      if (this.getCompletedAtForToday(workout)) {
        this.renderMain(workout);
        return;
      }

      if (!this.deviceCode) {
        this.deviceCode = ls_get(STORAGE_KEYS.DEVICE_CODE, "").trim();
      }

      const activeStatus = await this.fetchActiveSessionStatus();
      if (activeStatus?.status === 200 && activeStatus?.data?.active === true) {
        this.persistActiveSessionPayload(activeStatus.data);
        this.renderExerciseScreen();
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
          this.syncCompletedAtStorageFromPayload(response.data);
          this.clearActiveTrainingProgress();
          this.renderMain(workout);
          return;
        }

        if (response?.status === 201 && response?.data?.userWorkoutSessionId) {
          ls_remove(STORAGE_KEYS.COMPLETED_AT);
          persistWorkoutPayload(workout);
          persistSessionIdentifiers({
            sessionId: response.data.userWorkoutSessionId,
            startedAt: response.data.startedAt,
            activeDate: getTodayDateString(),
          });
          resetProgressForSession();
          this.renderExerciseScreen();
          return;
        }

        this.renderFriendlyError("Falha ao iniciar treino.", () => this.onStartWorkout());
      } catch (error) {
        logger.error(`Erro ao iniciar sessao: ${error?.message || error}`);
        this.renderFriendlyError("Falha ao iniciar treino.", () => this.onStartWorkout());
      }
    },

    onStartRest() {
      const training = this.getTrainingState(true);
      const currentExercise = training.currentExercise;
      const action = getProgressionAction(training);

      if (!currentExercise) {
        return;
      }

      if (action.type === "finish") {
        this.onCompleteLastSerie();
        return;
      }

      const restTimeFull = Math.max(0, Number(currentExercise?.restTimeInSeconds || 0));
      const now = new Date();
      const restStartedAt = now.toISOString();
      const restTargetAt = new Date(now.getTime() + restTimeFull * 1000).toISOString();
      const alarmId = this.scheduleRestAlarm(restTargetAt);
      ls_set(STORAGE_KEYS.SERIE_COMPLETED, true);

      persistRestState({
        restTimeFull,
        restStartedAt,
        restTargetAt,
        alarmId,
      });

      this.invalidateTrainingState();
      this.renderExerciseScreen();
    },

    onCompleteLastSerie() {
      ls_set(STORAGE_KEYS.SERIE_COMPLETED, true);
      this.invalidateTrainingState();
      this.renderExerciseScreen();
    },

    onProgressAfterRest() {
      const training = this.getTrainingState(true);

      if (training.restRunning) {
        return;
      }

      if (training.restStartedAt) {
        ls_remove(STORAGE_KEYS.REST_STARTED_AT);
      }

      const action = advanceProgress(training);
      this.invalidateTrainingState();

      if (action.type === "finish") {
        this.renderExerciseScreen();
        return;
      }

      this.renderExerciseScreen();
    },

    async onFinishWorkout() {
      const sessionId = ls_get(STORAGE_KEYS.ACTIVE_SESSION_ID, "").trim();
      const workout = ls_get(STORAGE_KEYS.TODAY_WORKOUT, {});

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
          workoutPlanId: workout?.workoutPlanId || ls_get(STORAGE_KEYS.WORKOUT_PLAN_ID, ""),
          workoutDayId: workout?.workoutDayId || ls_get(STORAGE_KEYS.WORKOUT_DAY_ID, ""),
          completedAt: new Date().toISOString(),
        };
        ls_set(STORAGE_KEYS.LAST_FINISH_DEBUG, finishPayload);

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
          this.cancelRestAlarm();
          ls_set(STORAGE_KEYS.COMPLETED_AT, finishPayload.completedAt);
          ls_clear_training_state();
          this.feedbackMessage = "Treino finalizado com sucesso";
          this.lastTodayPayload = {};
          const synced = await this.syncLinkedContext({ allowCachedFallback: false });
          if (!synced) {
            this.renderMain({});
          }
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
        const snapshot = getActiveSessionSnapshot();
        if (snapshot.date && snapshot.date !== getTodayDateString()) {
          ls_clear_training_state();
          this.invalidateTrainingState();
          await this.syncLinkedContext({ allowCachedFallback: true });
          return;
        }

        this.ensureRestConclusionIfNeeded();
        this.renderExerciseScreen();
        return;
      }

      if (this.currentScreen === UI_STATES.MAIN) {
        const cachedWorkout = this.lastTodayPayload || ls_get(STORAGE_KEYS.TODAY_WORKOUT, {});
        const hasRenderableMainState =
          !!cachedWorkout?.workoutDayId || cachedWorkout?.isRest === true || !!this.getCompletedAtForToday(cachedWorkout);

        if (hasRenderableMainState) {
          // Keep resume snappy: render cached state immediately and revalidate in background.
          this.renderMain(cachedWorkout);
          setTimeout(() => {
            if (this.isDestroyed) {
              return;
            }

            this.syncLinkedContext({ allowCachedFallback: true }).catch((error) => {
              logger.warn(`Falha ao revalidar contexto no resume: ${error?.message || error}`);
            });
          }, 0);
          return;
        }

        await this.syncLinkedContext({ allowCachedFallback: true });
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

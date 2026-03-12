import { notify } from "@zos/notification";

AppService({
  onInit(param) {
    if (param === "ack") {
      return;
    }

    notify({
      title: "Treino Fit AI",
      content: "O tempo de descanso acabou. Volte a acao!",
      actions: [
        {
          text: "Entendido",
          file: "service/timer_bg",
          param: "ack",
        },
      ],
      vibrate: 5,
    });
  },

  onDestroy() {},
});

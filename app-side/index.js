import { BaseSideService } from "@zeppos/zml/base-side";
import { handleWatchRequest } from "./watchApi";

AppSideService(
  BaseSideService({
    onInit() {
      console.log("app-side onInit");
    },

    onRun() {
      console.log("app-side onRun");
    },

    onDestroy() {
      console.log("app-side onDestroy");
    },

    onRequest(req, res) {
      if (handleWatchRequest(this, req, res)) {
        return;
      }

      res("Metodo nao suportado");
    },
  })
);

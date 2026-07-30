import { onAuthChange } from "./services/auth.service.js";
import { startRouter, renderRoute, navigate } from "./router.js";

startRouter();

let firstLoad = true;
onAuthChange((profile) => {
  if (firstLoad) {
    firstLoad = false;
    if (!location.hash) navigate(profile ? "/dashboard" : "/login");
  }
  renderRoute();
});

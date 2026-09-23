import { config } from "./config";
import { app } from "./app";

app.listen(config.PORT, () => {
  console.log(`SecureDocs API en http://localhost:${config.PORT}`);
});

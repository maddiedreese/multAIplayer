import { RuleTester } from "eslint";
import { desktopErrorHandlingPlugin } from "./desktop-error-handling.mjs";

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: "module" } });

tester.run("desktop/no-unreported-bare-catch", desktopErrorHandlingPlugin.rules["no-unreported-bare-catch"], {
  valid: [
    'try { await work(); } catch (error) { reportNonFatal("work", error); }',
    'task().catch((error) => reportNonFatal("task", error));'
  ],
  invalid: [
    { code: "try { await work(); } catch {}", errors: [{ messageId: "unreported" }] },
    { code: "task().catch(() => undefined);", errors: [{ messageId: "unreported" }] }
  ]
});

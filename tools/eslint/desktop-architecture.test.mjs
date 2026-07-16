import { RuleTester } from "eslint";
import { desktopArchitecturePlugin } from "./desktop-architecture.mjs";

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: "module" } });

tester.run("desktop/layer-boundaries", desktopArchitecturePlugin.rules["layer-boundaries"], {
  valid: [
    {
      filename: "/repo/apps/desktop/src/lib/history/roomHistory.js",
      code: 'import { normalizeChatMessage } from "../chat/chatSanitizer.js";'
    }
  ],
  invalid: [
    {
      filename: "/repo/apps/desktop/src/lib/chat/chatSanitizer.js",
      code: 'import { loadHistory } from "../history/localHistory.js";',
      errors: [{ messageId: "domain", data: { source: "chat", target: "history" } }]
    },
    {
      filename: "/repo/apps/desktop/src/application/room/actions.js",
      code: 'import { RoomPanel } from "../../components/RoomPanel.js";',
      errors: [{ messageId: "layer", data: { source: "application", target: "components" } }]
    }
  ]
});

tester.run("desktop/no-unreported-bare-catch", desktopArchitecturePlugin.rules["no-unreported-bare-catch"], {
  valid: [
    'try { await work(); } catch (error) { reportNonFatal("work", error); }',
    'task().catch((error) => reportNonFatal("task", error));'
  ],
  invalid: [
    {
      code: "try { await work(); } catch {}",
      errors: [{ messageId: "unreported" }]
    },
    {
      code: "task().catch(() => undefined);",
      errors: [{ messageId: "unreported" }]
    }
  ]
});

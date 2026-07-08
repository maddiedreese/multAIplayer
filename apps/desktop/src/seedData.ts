import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSpeed,
  defaultRoomMode,
  type ApprovalDelegationPolicy,
  type ApprovalPolicy,
  type RoomMode,
  type RoomRecord,
  type TeamMemberRecord,
  type TeamRecord
} from "@multaiplayer/protocol";
import { defaultProjectPath } from "./lib/localBackend";
import type { BrowserStatus, ChatMessage } from "./types";

export const fallbackUser = {
  id: "github:maddiedreese",
  name: "Maddie"
};

export const seededTeams: TeamRecord[] = [
  { id: "team-core", name: "Core Team", members: 4, role: "owner" },
  { id: "team-labs", name: "Labs", members: 2 }
];

export const seededTeamMembers: Record<string, TeamMemberRecord[]> = {
  "team-core": [
    { teamId: "team-core", userId: "github:maddiedreese", role: "owner", joinedAt: "2026-07-04T00:00:00.000Z" },
    { teamId: "team-core", userId: "github:alex", role: "admin", joinedAt: "2026-07-04T00:00:00.000Z" },
    { teamId: "team-core", userId: "github:tester", role: "member", joinedAt: "2026-07-04T00:00:00.000Z" },
    { teamId: "team-core", userId: "github:design", role: "member", joinedAt: "2026-07-04T00:00:00.000Z" }
  ],
  "team-labs": [
    { teamId: "team-labs", userId: "github:labs", role: "owner", joinedAt: "2026-07-04T00:00:00.000Z" },
    { teamId: "team-labs", userId: "github:research", role: "member", joinedAt: "2026-07-04T00:00:00.000Z" }
  ]
};

export const seededRooms: RoomRecord[] = [
  {
    id: "room-desktop",
    teamId: "team-core",
    name: "Desktop app",
    projectPath: defaultProjectPath,
    host: "Maddie",
    hostUserId: fallbackUser.id,
    hostStatus: "active",
    approvalPolicy: "ask_every_turn",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    mode: { ...defaultRoomMode, browser: true },
    codexModel: defaultCodexModel,
    codexReasoningEffort: defaultCodexReasoningEffort,
    codexSpeed: defaultCodexSpeed,
    browserAllowedOrigins: defaultBrowserAllowedOrigins,
    browserProfilePersistent: defaultBrowserProfilePersistent,
    unread: 0
  },
  {
    id: "room-relay",
    teamId: "team-core",
    name: "Relay ops",
    projectPath: defaultProjectPath,
    host: "Alex",
    hostUserId: "github:alex",
    hostStatus: "handoff",
    approvalPolicy: "auto_chat_only",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    mode: defaultRoomMode,
    codexModel: "gpt-5.3-codex-spark",
    codexReasoningEffort: "medium",
    codexSpeed: "standard",
    browserAllowedOrigins: defaultBrowserAllowedOrigins,
    browserProfilePersistent: defaultBrowserProfilePersistent,
    unread: 2
  },
  {
    id: "room-github",
    teamId: "team-labs",
    name: "GitHub flow",
    projectPath: defaultProjectPath,
    host: "No host",
    hostUserId: undefined,
    hostStatus: "offline",
    approvalPolicy: "never_host",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    mode: defaultRoomMode,
    codexModel: "gpt-5.3-codex-spark",
    codexReasoningEffort: "high",
    codexSpeed: "standard",
    browserAllowedOrigins: defaultBrowserAllowedOrigins,
    browserProfilePersistent: defaultBrowserProfilePersistent,
    unread: 0
  }
];

export const emptyRoom: RoomRecord = {
  id: "__empty-room",
  teamId: "__empty-team",
  name: "No room selected",
  projectPath: defaultProjectPath,
  host: "No host",
  hostUserId: undefined,
  hostStatus: "offline",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: defaultRoomMode,
  codexModel: defaultCodexModel,
  codexReasoningEffort: defaultCodexReasoningEffort,
  codexSpeed: defaultCodexSpeed,
  browserAllowedOrigins: defaultBrowserAllowedOrigins,
  browserProfilePersistent: defaultBrowserProfilePersistent,
  unread: 0
};

const initialMessages: ChatMessage[] = [
  {
    id: "m1",
    author: "Avery",
    role: "human",
    body: "We need to capture onboarding progress and improve the stepper.",
    time: "9:41"
  },
  {
    id: "m2",
    author: "Jordan",
    role: "human",
    body: "Agree. Let's track drop-offs by step and add unit tests for the new hook.",
    time: "9:42"
  },
  {
    id: "m3",
    author: "Avery",
    role: "human",
    body: "@Codex draft the plan",
    time: "9:43"
  },
  {
    id: "m4",
    author: "Codex",
    role: "codex",
    body: "I'll draft a plan and list the changes.\n\nPLAN (Run #18)\n1. Read project context and existing onboarding flow\n2. Add analytics tracking to onboarding steps\n3. Implement useOnboardingAnalytics hook\n4. Update stepper to emit events\n5. Add unit tests for the hook\n6. Update docs\n\nFILES TO CHANGE (6)\n- src/hooks/useOnboardingAnalytics.ts\n- src/components/Stepper.tsx\n- src/components/OnboardingStep.tsx\n- src/services/analytics.ts\n- tests/hooks/useOnboardingAnalytics.test.ts\n- docs/analytics/onboarding.md",
    time: "9:44"
  },
  {
    id: "m5",
    author: "Jordan",
    role: "human",
    body: "Looks good. Please also add tests for the analytics events.",
    time: "9:45"
  },
  {
    id: "m6",
    author: "Codex",
    role: "codex",
    body: "Will do. I'll include tests and update the plan.",
    time: "9:46"
  },
  {
    id: "m7",
    author: "Codex",
    role: "codex",
    body: "Plan updated. Ready for review.",
    time: "9:48",
    attachments: [{ id: "att-seed-plan", name: "docs/plan/run-18-plan.md", type: "code", size: 1800 }]
  }
];

export const initialMessagesByRoom: Record<string, ChatMessage[]> = {
  "room-desktop": initialMessages,
  "room-relay": [
    {
      id: "relay-m1",
      author: "Alex",
      role: "human",
      body: "The relay should stay boring: route room events, keep metadata tight, and avoid touching project content.",
      time: "09:52"
    },
    {
      id: "relay-m2",
      author: "Maddie",
      role: "human",
      body: "Yes. Gated invites should carry only room metadata; the host can approve access when someone joins.",
      time: "09:55"
    }
  ],
  "room-github": [
    {
      id: "github-m1",
      author: "Priya",
      role: "human",
      body: "V1 needs local commits, optional push, draft PR creation, and visible GitHub Actions status.",
      time: "11:03"
    }
  ]
};

export const approvalPolicyLabels: Record<ApprovalPolicy, string> = {
  ask_every_turn: "Ask every Codex turn",
  auto_chat_only: "Auto-approve chat-only turns",
  auto_browser_allowed_sites: "Legacy browser auto-approval",
  never_host: "Never host this room"
};

export const approvalDelegationPolicyLabels: Record<ApprovalDelegationPolicy, string> = {
  host_only: "Host only",
  members_can_request: "Members can request, host approves",
  members_can_approve: "Room members can approve",
  trusted_members_only: "Trusted members only"
};

export const roomModeLabels: Record<keyof RoomMode, string> = {
  chat: "Chat",
  code: "Code",
  workspace: "Workspace",
  browser: "Browser"
};

const initialTerminalLines = [
  "$ npm run dev:desktop",
  "VITE v6.0.11 ready in 392 ms",
  "Local: http://127.0.0.1:1420/",
  "$ npm run check",
  "TypeScript watching for changes..."
];

export const initialTerminalLinesByRoom: Record<string, string[]> = {
  "room-desktop": initialTerminalLines
};

export const maxTerminalActivityLines = 1000;

export const defaultBrowserStatus: BrowserStatus = {
  profilePath: null,
  downloadsBlocked: false,
  clipboardBlocked: false,
  fileUploadsBlocked: false
};

export const defaultBrowserUrl = "https://github.com/maddiedreese/multAIplayer";
export const defaultBrowserReason = "Use this page as Codex browser context.";

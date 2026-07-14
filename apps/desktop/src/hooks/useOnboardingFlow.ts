import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadOrCreateDeviceId } from "../lib/appRuntime";
import { chooseProjectFolder, defaultProjectPath, probeCodex } from "../lib/localBackend";
import { createOnboardingInviteJoinAdapter } from "../lib/onboardingInviteJoin";
import { completedTurnIds, hasNewCompletedTurn, newestInviteRequestForDevice } from "../lib/onboardingMilestones";
import { projectOnboardingReadiness, type OnboardingReadinessAction } from "../lib/onboardingReadiness";
import { deriveOnboardingProgress, type OnboardingIntent, type OnboardingSurface } from "../lib/onboardingState";
import { useAppStore } from "../store/appStore";
import { useCodexAccount } from "./useCodexAccount";
import type { useAppInviteActions } from "./useAppInviteActions";
import type { useAppWorkspaceFlow } from "./useAppWorkspaceFlow";
import type { useGitHubAuth } from "./useGitHubAuth";
import type { useNativeInviteIntake } from "./useNativeInviteIntake";
import type {
  OnboardingCreateDraft,
  OnboardingJoinState,
  OnboardingRoomRetryDraft
} from "../components/OnboardingAssistant";

type GitHubAuth = ReturnType<typeof useGitHubAuth>;
type WorkspaceFlow = ReturnType<typeof useAppWorkspaceFlow>;
type InviteActions = ReturnType<typeof useAppInviteActions>;
type NativeInvite = ReturnType<typeof useNativeInviteIntake>;

export function useOnboardingFlow({
  githubAuth,
  workspaceFlow,
  inviteActions,
  nativeInvite
}: {
  githubAuth: GitHubAuth;
  workspaceFlow: WorkspaceFlow;
  inviteActions: InviteActions;
  nativeInvite: NativeInvite;
}) {
  const account = useCodexAccount();
  const onboarding = useAppStore((state) => state.onboarding);
  const applyEvent = useAppStore((state) => state.applyOnboardingEvent);
  const workspaceStatus = useAppStore((state) => state.workspaceBootstrapStatus);
  const workspaceError = useAppStore((state) => state.workspaceBootstrapError);
  const codexProbe = useAppStore((state) => state.codexProbe);
  const selectedRoomId = useAppStore((state) => state.selectedRoomId);
  const selectedRoom = useAppStore((state) => state.rooms.find((room) => room.id === state.selectedRoomId));
  const inviteRuntime = useAppStore((state) => state.inviteByRoom[state.selectedRoomId]);
  const teamRoster = useAppStore((state) =>
    onboarding.markers.membership ? state.teamRosterByTeam[onboarding.markers.membership.teamId] : undefined
  );
  const codexRuntime = useAppStore((state) =>
    onboarding.markers.membership ? state.codexRuntimeByRoom[onboarding.markers.membership.roomId] : undefined
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null);
  const [joinState, setJoinState] = useState<OnboardingJoinState>({ phase: "idle" });
  const localDeviceId = useMemo(() => loadOrCreateDeviceId(), []);
  const completedTurnBaseline = useRef<Record<string, Set<string>>>({});

  useEffect(() => {
    if (!nativeInvite.invite) return;
    setJoinState({ phase: "idle" });
    applyEvent({ type: "choose_intent", intent: "join" });
  }, [applyEvent, nativeInvite.invite]);

  const intent: OnboardingIntent = onboarding.intent ?? "create";
  const readinessProjection = useMemo(
    () =>
      projectOnboardingReadiness({
        intent,
        workspace: { status: workspaceStatus, error: workspaceError },
        github: {
          configResolved: githubAuth.authConfigResolved,
          userResolved: githubAuth.currentUserResolved,
          config: githubAuth.authConfig,
          user: githubAuth.currentUser,
          busy: githubAuth.authBusy && !githubAuth.deviceFlow,
          error: githubAuth.authError
        },
        codexProbe,
        codexAccount: account.readiness,
        projectFolderSelected: selectedProjectPath !== null
      }),
    [
      account.readiness,
      codexProbe,
      githubAuth.authBusy,
      githubAuth.authConfig,
      githubAuth.authConfigResolved,
      githubAuth.authError,
      githubAuth.currentUser,
      githubAuth.currentUserResolved,
      githubAuth.deviceFlow,
      intent,
      selectedProjectPath,
      workspaceError,
      workspaceStatus
    ]
  );

  useEffect(() => {
    if (codexProbe?.available && account.readiness.ready && !onboarding.markers.codexConnected) {
      applyEvent({ type: "codex_connected" });
    }
  }, [account.readiness.ready, applyEvent, codexProbe?.available, onboarding.markers.codexConnected]);

  useEffect(() => {
    const membership = onboarding.markers.membership;
    if (!membership || onboarding.markers.teammateJoined) return;
    if ((teamRoster?.members?.length ?? 0) > 1) applyEvent({ type: "teammate_joined", teamId: membership.teamId });
  }, [applyEvent, onboarding.markers.membership, onboarding.markers.teammateJoined, teamRoster?.members?.length]);

  useEffect(() => {
    const membership = onboarding.markers.membership;
    if (!membership || onboarding.surface !== "guided_turn" || onboarding.markers.firstTurnCompleted) return;
    completedTurnBaseline.current[membership.roomId] ??= completedTurnIds(codexRuntime?.events ?? []);
  }, [codexRuntime?.events, onboarding.markers.firstTurnCompleted, onboarding.markers.membership, onboarding.surface]);

  useEffect(() => {
    const membership = onboarding.markers.membership;
    if (!membership || onboarding.surface !== "guided_turn" || onboarding.markers.firstTurnCompleted) return;
    const baseline = completedTurnBaseline.current[membership.roomId];
    if (!baseline) return;
    if (hasNewCompletedTurn(codexRuntime?.events ?? [], baseline)) {
      applyEvent({ type: "first_turn_completed", roomId: membership.roomId });
    }
  }, [
    applyEvent,
    codexRuntime?.events,
    onboarding.markers.firstTurnCompleted,
    onboarding.markers.membership,
    onboarding.surface
  ]);

  useEffect(() => {
    const localRequest = newestInviteRequestForDevice(
      inviteRuntime?.requests ?? [],
      githubAuth.currentUser?.id,
      localDeviceId
    );
    if (!selectedRoom || !localRequest || selectedRoom.hostUserId === githubAuth.currentUser?.id) return;
    if (onboarding.markers.membership === null && onboarding.intent !== "join") {
      applyEvent({ type: "choose_intent", intent: "join" });
      applyEvent({ type: "show_surface", surface: "workspace" });
    }
    if (localRequest.status === "approved") {
      if (onboarding.markers.membership?.roomId !== selectedRoom.id) {
        applyEvent({ type: "room_ready", intent: "join", teamId: selectedRoom.teamId, roomId: selectedRoom.id });
      }
      if (joinState.phase !== "complete") {
        setJoinState({ phase: "complete", message: "This device was approved and the encrypted room is ready." });
      }
    } else if (localRequest.status === "denied") {
      if (joinState.phase !== "error") {
        setJoinState({
          phase: "error",
          message: "The host did not approve this device. Ask for a new invite to try again."
        });
      }
    } else if (joinState.phase !== "verification_required") {
      setJoinState({
        phase: "verification_required",
        message: "Access requested. The active host must verify and approve this device before the room unlocks."
      });
    }
  }, [
    applyEvent,
    githubAuth.currentUser?.id,
    inviteRuntime?.requests,
    joinState.phase,
    localDeviceId,
    onboarding.intent,
    onboarding.markers.membership,
    selectedRoom
  ]);

  const chooseFolder = useCallback(async (currentPath = "") => {
    try {
      const path = await chooseProjectFolder(currentPath || defaultProjectPath);
      if (path) setSelectedProjectPath(path);
      return path;
    } catch {
      setMessage("The project folder could not be opened. Check folder access and try again.");
      return null;
    }
  }, []);

  const runReadinessAction = useCallback(
    async (action: OnboardingReadinessAction) => {
      setMessage(null);
      if (action === "retry_workspace_bootstrap") {
        useAppStore.getState().retryWorkspaceBootstrap();
        githubAuth.retryAuthBootstrap();
      } else if (action === "sign_in_github") {
        await githubAuth.beginGitHubSignIn();
      } else if (action === "sign_in_chatgpt") {
        await account.beginLogin("browser");
      } else if (action === "select_project_folder") {
        await chooseFolder(selectedProjectPath ?? "");
      } else if (action === "update_codex") {
        window.open("https://developers.openai.com/codex/cli", "_blank", "noopener,noreferrer");
      } else {
        setBusy(true);
        try {
          useAppStore.getState().replaceCodexProbe(await probeCodex());
          await account.refresh();
        } catch {
          setMessage("Codex could not be checked. Confirm the installation and try again.");
        } finally {
          setBusy(false);
        }
      }
    },
    [account, chooseFolder, githubAuth, selectedProjectPath]
  );

  const create = useCallback(
    async (draft: OnboardingCreateDraft | OnboardingRoomRetryDraft) => {
      setBusy(true);
      setMessage(null);
      try {
        const existingTeamId = "teamId" in draft ? draft.teamId : undefined;
        const result = await workspaceFlow.createOnboardingWorkspace({
          workspaceName: "workspaceName" in draft ? draft.workspaceName : "Existing workspace",
          roomName: draft.roomName,
          projectPath: draft.projectPath,
          ...(existingTeamId ? { existingTeamId } : {})
        });
        if (result.status === "partial_team") {
          applyEvent({ type: "workspace_created", teamId: result.team.id });
          setMessage(
            "The workspace was created, but the first room was not. Fix the issue and retry; no duplicate workspace will be created."
          );
          return;
        }
        applyEvent({ type: "room_ready", intent: "create", teamId: result.team.id, roomId: result.room.id });
        applyEvent({ type: "project_attached", roomId: result.room.id });
        setMessage("Your encrypted workspace and first room are ready.");
      } catch {
        setMessage(
          "Workspace setup could not be completed. Check each field and the relay connection, then try again."
        );
      } finally {
        setBusy(false);
      }
    },
    [applyEvent, workspaceFlow]
  );

  const submitJoin = useCallback(
    async ({ invite }: { invite: string }) => {
      setBusy(true);
      setMessage(null);
      setJoinState({ phase: "accepting", message: "Verifying the invite and this device…" });
      const adapter = createOnboardingInviteJoinAdapter({
        requestNoSecretInviteAccess: inviteActions.requestNoSecretInviteAccess
      });
      const result = await adapter.joinManualInput(invite);
      setBusy(false);
      setJoinState(
        result.status === "approval_pending"
          ? { phase: "verification_required", message: result.message }
          : { phase: "error", message: result.message }
      );
    },
    [inviteActions.requestNoSecretInviteAccess]
  );

  const submitReceivedInvite = useCallback(async () => {
    const invite = nativeInvite.invite;
    if (!invite) return;
    // Consume the React-memory copy before native/relay work. Errors present a
    // safe recovery message and require reopening or manually pasting the link.
    nativeInvite.clearInvite();
    setBusy(true);
    setMessage(null);
    setJoinState({ phase: "accepting", message: "Verifying the invite and this device…" });
    const adapter = createOnboardingInviteJoinAdapter({
      requestNoSecretInviteAccess: inviteActions.requestNoSecretInviteAccess
    });
    const result = await adapter.joinProtectedPayload(invite.encodedInvite, invite.inviteId);
    setBusy(false);
    setJoinState(
      result.status === "approval_pending"
        ? { phase: "verification_required", message: result.message }
        : { phase: "error", message: result.message }
    );
  }, [inviteActions.requestNoSecretInviteAccess, nativeInvite]);

  const showSurface = useCallback(
    (surface: OnboardingSurface) => applyEvent({ type: "show_surface", surface }),
    [applyEvent]
  );
  const continueSafety = useCallback(() => showSurface("guided_turn"), [showSurface]);
  const dismiss = useCallback(() => applyEvent({ type: "dismiss_assistant" }), [applyEvent]);

  return {
    state: onboarding,
    progress: deriveOnboardingProgress(onboarding),
    readiness: readinessProjection,
    joinState,
    busy,
    message,
    selectedProjectPath: selectedProjectPath ?? "",
    githubAuthentication: githubAuth.deviceFlow
      ? {
          provider: "github" as const,
          flow: "device" as const,
          url: githubAuth.deviceFlow.verification_uri,
          userCode: githubAuth.deviceFlow.user_code,
          expiresAt: githubAuth.deviceFlow.expiresAt,
          browserOpenFailed: githubAuth.authenticationBrowserOpenFailed
        }
      : null,
    codexAuthentication: account.login
      ? {
          provider: "chatgpt" as const,
          flow: account.login.flow,
          url: account.login.url,
          userCode: account.login.userCode,
          expiresAt: null,
          browserOpenFailed: account.loginBrowserOpenFailed
        }
      : null,
    supportsCodexDeviceLogin: account.snapshot?.capabilities.supportsDeviceLogin === true,
    receivedInvite: nativeInvite.invite !== null,
    blockingAssistant: deriveOnboardingProgress(onboarding).assistantVisible && onboarding.surface !== "guided_turn",
    guidedVisible:
      deriveOnboardingProgress(onboarding).assistantVisible &&
      onboarding.surface === "guided_turn" &&
      onboarding.markers.membership?.roomId === selectedRoomId,
    onChooseIntent: (next: OnboardingIntent) => applyEvent({ type: "choose_intent", intent: next }),
    onExplore: () => applyEvent({ type: "skip_assistant" }),
    onShowSurface: showSurface,
    onReadinessAction: runReadinessAction,
    onStartCodexDeviceLogin: () => void account.beginLogin("device"),
    onCancelGitHubAuthentication: githubAuth.cancelGitHubSignIn,
    onCancelCodexAuthentication: () => void account.cancelLogin(),
    onSubmitCreate: create,
    onRetryRoomCreation: create,
    onSubmitJoin: submitJoin,
    onSubmitReceivedInvite: () => void submitReceivedInvite(),
    onChooseProjectFolder: chooseFolder,
    onContinueSafety: continueSafety,
    onDismiss: dismiss
  };
}

// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useAui, type ThreadMessage } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePaperclipIssueRuntime } from "./usePaperclipIssueRuntime";

type AssistantApi = ReturnType<typeof useAui>;
type RuntimeOptions = Parameters<typeof usePaperclipIssueRuntime>[0];

function CaptureApi({ onApi }: { onApi: (api: AssistantApi) => void }) {
  const api = useAui();
  useEffect(() => onApi(api), [api, onApi]);
  return null;
}

function RuntimeHarness({ onApi, ...options }: RuntimeOptions & { onApi: (api: AssistantApi) => void }) {
  const runtime = usePaperclipIssueRuntime(options);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <CaptureApi onApi={onApi} />
    </AssistantRuntimeProvider>
  );
}

describe("usePaperclipIssueRuntime with real Assistant UI", () => {
  let container: HTMLDivElement;
  let root: Root;
  let capturedApi: AssistantApi | undefined;

  const onApi = (api: AssistantApi) => {
    capturedApi = api;
  };
  const getApi = () => {
    if (!capturedApi) throw new Error("Assistant UI API was not initialized");
    return capturedApi;
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    capturedApi = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends through the property API with handoff metadata and the latest callback", async () => {
    const firstOnSend = vi.fn(async () => {});
    const latestOnSend = vi.fn(async () => {});
    const messages: ThreadMessage[] = [];

    await act(async () => {
      root.render(<RuntimeHarness onApi={onApi} messages={messages} isRunning={false} onSend={firstOnSend} />);
    });
    await act(async () => {
      root.render(<RuntimeHarness onApi={onApi} messages={messages} isRunning={false} onSend={latestOnSend} />);
    });
    await act(async () => {
      await getApi().thread.append({
        role: "user",
        content: [{ type: "text", text: "  Continue this task.  " }],
        runConfig: {
          custom: {
            reopen: true,
            reassignment: { assigneeAgentId: "agent-123", assigneeUserId: null },
          },
        },
      });
    });

    expect(firstOnSend).not.toHaveBeenCalled();
    expect(latestOnSend).toHaveBeenCalledExactlyOnceWith({
      body: "Continue this task.",
      reopen: true,
      reassignment: { assigneeAgentId: "agent-123", assigneeUserId: null },
    });
  });

  it("reflects external messages and running state and calls the latest cancellation handler", async () => {
    const onSend = vi.fn(async () => {});
    const firstOnCancel = vi.fn(async () => {});
    const latestOnCancel = vi.fn(async () => {});
    const messages: ThreadMessage[] = [{
      id: "message-1",
      role: "user",
      content: [{ type: "text", text: "Hello" }],
      createdAt: new Date("2026-10-24T12:00:00Z"),
      metadata: { custom: {} },
      attachments: [],
    }];

    await act(async () => {
      root.render(
        <RuntimeHarness onApi={onApi} messages={[]} isRunning={false} onSend={onSend} onCancel={firstOnCancel} />,
      );
    });
    expect(getApi().thread.getState().messages).toHaveLength(0);
    expect(getApi().thread.getState().isRunning).toBe(false);

    await act(async () => {
      root.render(
        <RuntimeHarness onApi={onApi} messages={messages} isRunning onSend={onSend} onCancel={latestOnCancel} />,
      );
    });
    expect(getApi().thread.getState().messages[0]?.id).toBe("message-1");
    expect(getApi().thread.getState().isRunning).toBe(true);

    await act(async () => {
      await getApi().thread.cancelRun();
    });
    expect(firstOnCancel).not.toHaveBeenCalled();
    expect(latestOnCancel).toHaveBeenCalledOnce();
  });

  it("reports failed fire-and-forget sends", async () => {
    const error = new Error("Comment submission failed");
    const onSend = vi.fn().mockRejectedValue(error);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      root.render(<RuntimeHarness onApi={onApi} messages={[]} isRunning={false} onSend={onSend} />);
    });
    await act(async () => {
      getApi().thread.append({
        role: "user",
        content: [{ type: "text", text: "Retry this task." }],
      });
    });
    expect(onSend).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith("[assistant-ui] Message append failed", error);
  });
});

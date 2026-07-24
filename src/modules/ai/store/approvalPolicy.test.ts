import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approvalPolicyState,
  isAutoApproved,
  useApprovalPolicyStore,
} from "./approvalPolicy";

describe("approvalPolicy store", () => {
  beforeEach(() => {
    useApprovalPolicyStore.getState().reset();
  });
  afterEach(() => {
    useApprovalPolicyStore.getState().reset();
  });

  it("starts with no rules and no budget", () => {
    const s = approvalPolicyState();
    expect(s.sessionAllowed).toEqual([]);
    expect(s.approveAllRemaining).toEqual({});
    expect(isAutoApproved(s, "edit", "/a/b.ts")).toBe(false);
  });

  it("allowTool grants session-wide auto-approve for that kind", () => {
    useApprovalPolicyStore.getState().allowTool({ toolName: "edit" });
    const s = approvalPolicyState();
    expect(isAutoApproved(s, "edit", "/any/path.ts")).toBe(true);
    expect(isAutoApproved(s, "write_file", "/any/x.ts")).toBe(false);
  });

  it("allowTool with pathPrefix only matches that subtree", () => {
    useApprovalPolicyStore
      .getState()
      .allowTool({ toolName: "edit", pathPrefix: "/proj/src" });
    const s = approvalPolicyState();
    expect(isAutoApproved(s, "edit", "/proj/src/a.ts")).toBe(true);
    expect(isAutoApproved(s, "edit", "/proj/tests/a.ts")).toBe(false);
  });

  it("allowTool dedupes identical rules", () => {
    const { allowTool } = useApprovalPolicyStore.getState();
    allowTool({ toolName: "edit" });
    allowTool({ toolName: "edit" });
    expect(approvalPolicyState().sessionAllowed).toHaveLength(1);
  });

  it("revokeTool removes a matching rule", () => {
    const { allowTool, revokeTool } = useApprovalPolicyStore.getState();
    allowTool({ toolName: "edit", pathPrefix: "/p" });
    revokeTool({ toolName: "edit", pathPrefix: "/p" });
    expect(approvalPolicyState().sessionAllowed).toHaveLength(0);
  });

  it("setApproveAll + dec consume a countdown budget", () => {
    const { setApproveAll, dec } = useApprovalPolicyStore.getState();
    setApproveAll("bash_run", 2);
    expect(isAutoApproved(approvalPolicyState(), "bash_run")).toBe(true);
    dec("bash_run");
    expect(isAutoApproved(approvalPolicyState(), "bash_run")).toBe(true);
    dec("bash_run");
    expect(isAutoApproved(approvalPolicyState(), "bash_run")).toBe(false);
    // budget entry is cleaned up at zero
    expect(approvalPolicyState().approveAllRemaining).toEqual({});
  });

  it("dec is a no-op when no budget remains", () => {
    useApprovalPolicyStore.getState().dec("edit");
    expect(approvalPolicyState().approveAllRemaining).toEqual({});
  });

  it("reset clears both rules and budget", () => {
    const { allowTool, setApproveAll, reset } = useApprovalPolicyStore.getState();
    allowTool({ toolName: "edit" });
    setApproveAll("bash_run", 5);
    reset();
    const s = approvalPolicyState();
    expect(s.sessionAllowed).toEqual([]);
    expect(s.approveAllRemaining).toEqual({});
  });
});

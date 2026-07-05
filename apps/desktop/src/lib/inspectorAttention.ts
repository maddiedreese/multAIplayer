type RequestLike = {
  status: string;
};

export function countPendingRequests(requests: RequestLike[]): number {
  return requests.filter((request) => request.status === "pending").length;
}

export function inspectorAttentionCounts({
  approvalVisible,
  terminalRequests,
  browserRequests
}: {
  approvalVisible: boolean;
  terminalRequests: RequestLike[];
  browserRequests: RequestLike[];
}): { work: number; browser: number } {
  return {
    work: countPendingRequests(terminalRequests) + (approvalVisible ? 1 : 0),
    browser: countPendingRequests(browserRequests)
  };
}

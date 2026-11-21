const FUJI = "0xa869";
const EVENT = "0x4511436f903ee89a426cb6cd458019f3996b82791afbdfb955afa27e8cc75377";
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const word = (n) => n.toString(16).padStart(64, "0");
const addressWord = (address) => address.toLowerCase().slice(2).padStart(64, "0");

export function prepareAttestation(result) {
  const { report, attestation } = result ?? {};
  if (attestation?.status !== "READY_TO_ATTEST" || !report || report.summary?.scoredFindingCount === 0) return null;
  return encodeIntent(report, attestation.reportHash, attestation.registryAddress, attestation.ipfsUri);
}

export function prepareFujiSmokeAttestation(result) {
  const { report, attestation, fujiSmoke } = result ?? {};
  const target = report?.targetContract;
  const registry = fujiSmoke?.registryAddress;
  if (attestation?.status !== "NOT_ATTESTABLE" || report?.reviewMode !== "static"
      || report.summary?.priorityScore !== 0 || report.summary.scoredFindingCount !== 0
      || target?.status !== "available" || target.chainId !== 43113 || target.isContract !== true
      || typeof registry !== "string" || typeof target.address !== "string"
      || target.address.toLowerCase() !== registry.toLowerCase()) return null;
  return encodeIntent(report, attestation.reportHash, registry, fujiSmoke.ipfsUri);
}

function encodeIntent(report, hash, registry, ipfsUri) {
  const target = report.targetContract?.address;
  const score = report.summary?.priorityScore;
  if (!ADDRESS.test(registry) || !ADDRESS.test(target) || !HASH.test(hash)
      || !Number.isInteger(score) || score < 0 || score > 100 || ipfsUri !== ""
      || /^(0x0+)$/i.test(registry) || /^(0x0+)$/i.test(target) || /^(0x0+)$/i.test(hash)) return null;
  const args = addressWord(target) + hash.slice(2) + word(score) + word(128) + word(0);
  return { registry, hash, target, score, data: "0x4fd9d719" + args };
}

export async function submitAttestation(provider, intent) {
  if (!provider?.request) throw new Error("Cần ví trình duyệt hỗ trợ EIP-1193.");
  const [account] = await provider.request({ method: "eth_requestAccounts" });
  if (!ADDRESS.test(account)) throw new Error("Ví chưa cung cấp tài khoản.");
  const chain = () => provider.request({ method: "eth_chainId" });
  if (await chain() !== FUJI) {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: FUJI }] });
  }
  if (await chain() !== FUJI) throw new Error("Chuyển ví sang Avalanche Fuji trước khi ký.");
  const code = await provider.request({ method: "eth_getCode", params: [intent.registry, "latest"] });
  if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(code)) {
    throw new Error("Không thấy mã của registry trên Fuji.");
  }
  if (await chain() !== FUJI) throw new Error("Mạng ví đã thay đổi.");
  const txHash = await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: account, to: intent.registry, data: intent.data, value: "0x0" }],
  });
  if (!HASH.test(txHash)) throw new Error("Ví trả về mã giao dịch không hợp lệ.");
  return { txHash, account };
}

export async function checkAttestationReceipt(provider, intent, { txHash, account }) {
  if (await provider.request({ method: "eth_chainId" }) !== FUJI) return "pending";
  const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] });
  if (!receipt) return "pending";
  const matches = receipt.logs?.some((log) =>
    log.address?.toLowerCase() === intent.registry.toLowerCase()
    && log.topics?.[0]?.toLowerCase() === EVENT
    && log.topics?.[2]?.toLowerCase() === "0x" + addressWord(intent.target)
    && log.topics?.[3]?.toLowerCase() === "0x" + addressWord(account)
    && log.data?.toLowerCase().startsWith(intent.hash.toLowerCase() + word(intent.score))
  );
  return receipt.status === "0x1" && matches ? "confirmed" : "failed";
}

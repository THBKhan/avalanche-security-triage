import { checkAttestationReceipt, prepareAttestation, submitAttestation } from "./wallet.mjs";

const $ = (id) => document.getElementById(id);
const element = (tag, text = "", cls = "") => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const demoSource = "pragma solidity ^0.8.20;\n\ncontract Demo {\n    function ping() external pure returns (bool) {\n        return true;\n    }\n}";
const demo = {
  mode: "source-analysis",
  report: {
    reviewMode: "static",
    summary: { totalVulnerabilities: 1, scoredFindingCount: 0, priorityScore: 0 },
    targetContract: { status: "unspecified" },
    findings: [{
      title: "Floating Solidity pragma", function: "Global", severity: "LOW", confidence: "HIGH",
      scores: { exploitability: 10, exposure: 10, assetImpact: 0, priorityScore: 7 },
      description: "Dải phiên bản cho phép nhiều bản compiler khác nhau.",
      evidence: ["L1: pragma solidity ^0.8.20;"],
      patchDiff: "--- a/Demo.sol\n+++ b/Demo.sol\n@@ -1 +1 @@\n-pragma solidity ^0.8.20;\n+pragma solidity 0.8.20;",
    }],
    limitations: ["Dữ liệu minh họa. Chọn Phân tích để chạy các kiểm tra trên mã đã nhập."],
  },
  attestation: { status: "DISABLED", disabledReason: "Dữ liệu mẫu không thể ghi lên Fuji." },
};

let result = null;
let request = null;
let signing = false;
let intentToSign = null;
let downloadUrl = null;

function notify(message, isError = false) {
  $("status").hidden = !message;
  $("status").textContent = message;
  $("status").classList.toggle("error", isError);
}

function metric(label, value) {
  const box = element("div", "", "metric");
  box.append(element("strong", String(value)), element("span", label));
  return box;
}

function renderFindings() {
  const items = result?.report?.findings ?? [];
  const filter = $("severity").value;
  const visible = filter === "ALL" ? items : items.filter((item) => item.severity === filter);
  $("findings").replaceChildren();
  if (!visible.length) {
    $("findings").append(element("p", items.length
      ? "Không có phát hiện ở mức đã chọn."
      : "Các kiểm tra hiện có chưa ghi nhận phát hiện.", "muted"));
  }
  for (const finding of visible) {
    const detail = element("details", "", "finding");
    const title = element("summary");
    title.append(
      element("span", finding.severity, "pill " + finding.severity),
      document.createTextNode(finding.title + " · " + finding.scores.priorityScore),
    );
    detail.append(title, element("p", finding.function + " · Độ tin cậy " + finding.confidence, "muted"),
      element("p", finding.description));
    const bars = element("div", "", "bars");
    for (const [label, key] of [["Exploitability", "exploitability"], ["Exposure", "exposure"], ["Asset Impact", "assetImpact"]]) {
      const row = element("div", "", "bar");
      const bar = document.createElement("progress");
      bar.max = 100;
      bar.value = finding.scores[key];
      bar.setAttribute("aria-label", label);
      row.append(element("span", label), bar, element("span", String(bar.value)));
      bars.append(row);
    }
    detail.append(bars);
    if (finding.evidence.length) detail.append(element("pre", finding.evidence.join("\n\n")));
    if (finding.review) {
      detail.append(element("h3", "Nhận xét của Gemini"), element("p", `${finding.review.verdict} · ${finding.review.confidence}`, "muted"),
        element("p", finding.review.explanation));
      if (finding.review.remediation) {
        detail.append(element("h3", "AI đề xuất"), element("p", finding.review.remediation));
      }
    }
    if (finding.patchDiff) {
      const diff = element("pre", "", "diff");
      for (const line of finding.patchDiff.split("\n")) {
        const cls = /^\+(?!\+\+)/.test(line) ? "added" : /^-(?!--)/.test(line) ? "removed" : "";
        diff.append(element("span", line || " ", cls));
      }
      detail.append(element("h3", result === demo ? "Diff minh họa" : "AI đề xuất"), diff);
    }
    for (const note of [...(finding.limitations ?? []), ...(finding.review?.limitations ?? [])]) {
      detail.append(element("p", note, "muted"));
    }
    $("findings").append(detail);
  }
}

function render(payload, label) {
  result = payload;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  $("download").href = downloadUrl;
  notify("");
  $("result").hidden = false;
  $("mode").hidden = false;
  $("mode").textContent = label;
  $("wallet-status").replaceChildren();
  $("severity").value = "ALL";
  const { report, attestation } = payload;
  const context = report?.targetContract ?? payload.targetContract;
  const contextAvailable = context?.status === "available";
  const metrics = [];
  if (report) {
    const count = report.summary.scoredFindingCount ?? report.findings.length;
    metrics.push(metric("Điểm ưu tiên", count ? report.summary.priorityScore : "—"), metric("Phát hiện", report.findings.length));
  }
  if (contextAvailable) metrics.push(metric("Số dư AVAX", context.balanceAvax), metric("Bytecode", context.bytecodeSize + " B"));
  $("metrics").replaceChildren(...metrics);
  $("context").hidden = !context?.address && !context?.warning;
  $("context").replaceChildren();
  if (context?.address) $("context").append(element("p", context.address));
  if (contextAvailable) {
    const paused = context.isPaused === true ? "Có" : context.isPaused === false ? "Không" : "Chưa xác định";
    $("context").append(element("p", `Owner: ${context.owner ?? "Chưa xác định"} · Paused: ${paused}`),
      element("p", "Thời điểm đọc: " + new Date(context.queriedAt).toLocaleString("vi-VN")));
  }
  if (context?.warning) $("context").append(element("p", context.warning));
  $("finding-section").hidden = !report;
  renderFindings();
  const limits = [...(report?.limitations ?? [])];
  if (report?.policy) limits.push("Quy tắc điểm: " + report.policy);
  if (report?.sourceDigest) limits.push("Hash mã nguồn: " + report.sourceDigest);
  if (report?.coverage?.unanalyzedRules.length) {
    limits.push("Chưa có kiểm tra cho: " + report.coverage.unanalyzedRules.join(", "));
  }
  $("limitations").hidden = limits.length === 0;
  $("limit-list").replaceChildren(...limits.map((note) => element("li", note)));
  const intent = prepareAttestation(payload);
  $("attest").disabled = !intent || !window.ethereum?.request;
  $("attest-note").textContent = intent
    ? window.ethereum?.request ? "Ví sẽ hỏi xác nhận giao dịch trước khi gửi." : "Cần ví trình duyệt để ghi nhận."
    : (attestation?.disabledReason ?? "Báo cáo chưa đủ điều kiện ghi nhận.");
  $("hash").hidden = !attestation?.reportHash;
  $("hash").textContent = attestation?.reportHash ?? "";
}

function busy(isBusy) {
  $("submit").disabled = isBusy || signing;
  $("sample").disabled = isBusy || signing;
  $("submit").textContent = isBusy ? "Đang phân tích…" : "Phân tích";
}

$("analyze").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (request || signing) return;
  const address = $("address").value.trim();
  const source = $("source").value;
  if (!address && !source.trim()) return notify("Nhập địa chỉ hoặc mã Solidity.", true);
  if (address && (!/^0x[0-9a-f]{40}$/i.test(address) || /^0x0{40}$/i.test(address))) {
    return notify("Nhập địa chỉ Fuji hợp lệ.", true);
  }
  const payload = {
    ...(address ? { contractAddress: address } : {}),
    ...(source.trim() ? { sourceCode: source } : {}),
    ...($("gemini").checked && source.trim() ? { reviewWithGemini: true } : {}),
  };
  request = new AbortController();
  const timer = setTimeout(() => request?.abort(), 38_000);
  busy(true);
  result = null;
  $("result").hidden = true;
  $("mode").hidden = true;
  notify("Đang đọc dữ liệu và tạo báo cáo…");
  try {
    const response = await fetch("/api/analyze", {
      method: "POST", body: JSON.stringify(payload), signal: request.signal,
      headers: { "Content-Type": "application/json" },
    });
    const body = await response.json();
    if (!response.ok) {
      const suffix = Number.isInteger(body.error?.details?.line) ? ` (dòng ${body.error.details.line})` : "";
      return notify((body.error?.message ?? "Không thể phân tích yêu cầu.") + suffix, true);
    }
    render(body, body.mode === "context-only" ? "Ngữ cảnh Fuji" : body.report.reviewMode === "gemini" ? "Gemini review" : "Phân tích tĩnh");
  } catch (error) {
    notify(error.name === "AbortError" ? "Hết thời gian chờ phân tích." : "Không kết nối được với backend.", true);
  } finally {
    clearTimeout(timer);
    request = null;
    busy(false);
  }
});

$("sample").addEventListener("click", () => {
  if (request || signing) return;
  $("source").value = demoSource;
  $("address").value = "";
  $("gemini").checked = false;
  render(demo, "Dữ liệu mẫu");
});
$("severity").addEventListener("change", renderFindings);
$("attest").addEventListener("click", () => {
  if (signing || request) return;
  const intent = prepareAttestation(result);
  if (!intent) return;
  intentToSign = { result, intent };
  const values = [["Địa chỉ mục tiêu", intent.target], ["Registry", intent.registry], ["Điểm ưu tiên", intent.score], ["Report hash", intent.hash]];
  $("tx-summary").replaceChildren(...values.flatMap(([label, value]) => [element("dt", label), element("dd", String(value))]));
  $("ack").checked = false;
  $("confirm").returnValue = "";
  $("confirm").showModal();
});
$("cancel-attest").addEventListener("click", () => $("confirm").close());
$("confirm").addEventListener("close", async () => {
  const pending = intentToSign;
  intentToSign = null;
  if ($("confirm").returnValue !== "confirm" || !pending || pending.result !== result || signing) return;
  signing = true;
  let confirmed = false;
  busy(false);
  $("attest").disabled = true;
  $("wallet-status").textContent = "Đang chờ xác nhận trong ví…";
  try {
    const provider = window.ethereum;
    const submission = await submitAttestation(provider, pending.intent);
    const tx = element("a", "Xem giao dịch");
    tx.href = "https://testnet.snowtrace.io/tx/" + submission.txHash;
    tx.target = "_blank";
    tx.rel = "noopener noreferrer";
    const status = element("span", "Đã gửi. Đang đợi xác nhận. ");
    $("wallet-status").replaceChildren(status, tx);
    for (let attempt = 0; attempt < 20; attempt++) {
      const receipt = await checkAttestationReceipt(provider, pending.intent, submission).catch(() => "pending");
      if (receipt === "confirmed") {
        confirmed = true;
        status.textContent = "Registry đã ghi nhận báo cáo. ";
        return;
      }
      if (receipt === "failed") { status.textContent = "Giao dịch không ghi nhận attestation như mong đợi. "; return; }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    status.textContent = "Chưa xác nhận được. Kiểm tra giao dịch trên explorer. ";
  } catch (error) {
    $("wallet-status").textContent = error?.code === 4001
      ? "Bạn đã từ chối trong ví."
      : "Không gửi được giao dịch. Kiểm tra mạng Fuji, registry và tài khoản ví.";
  } finally {
    signing = false;
    busy(false);
    $("attest").disabled = confirmed || !prepareAttestation(result);
  }
});

fetch("/api/config").then((response) => response.json()).then((config) => {
  $("gemini-option").hidden = config.geminiAvailable !== true;
}).catch(() => {});

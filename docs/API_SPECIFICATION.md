# 📡 Đặc Tả API: Avalanche Security Triage (`POST /api/analyze`)

> **Mục tiêu:** Thống nhất hợp đồng giao tiếp giữa Frontend Web Dashboard và Backend Triage Engine cho dự án Avalanche Security Triage.  
> **Schema tham chiếu:** [analyze-request.schema.json](schema/analyze-request.schema.json) và [analyze-response.schema.json](schema/analyze-response.schema.json)
> **Phạm vi mạng:** Mạng Avalanche Fuji Testnet (Chain ID `43113`), không ngầm mở sang Mainnet trong phạm vi bản demo.

---

## 1. Tổng Quan Endpoint

- **Path:** `/api/analyze`
- **Method:** `POST`
- **Content-Type:** `application/json`
- **Nguyên tắc an toàn:**
  - Source code và comments từ client được xem là **dữ liệu không tin cậy (untrusted data)**, không phải chỉ dẫn (prompt instructions) cho AI model.
  - Backend là nơi **duy nhất** tính toán, làm tròn và xác thực `priorityScore` và `reportHash`. Frontend tuyệt đối không tính lại hoặc làm tròn lại điểm.
  - Patch diff từ AI chỉ mang tính chất **gợi ý/đề xuất (proposal)**, không được tự động áp dụng.

---

## 2. Request Payload & Xác Thực Đầu Vào

### Định dạng
```json
{
  "sourceCode": "pragma solidity 0.8.20; contract Vault { ... }",
  "contractAddress": "0x5462D6Bcf9E7C030364d276d493a7F9D0388d754"
}
```

### Các trường và ràng buộc:
| Tên trường | Kiểu | Bắt buộc? | Ràng buộc Schema | Ràng buộc Runtime |
| :--- | :--- | :---: | :--- | :--- |
| `sourceCode` | `string` | Tùy chọn* | `minLength: 1`, `pattern: "^\s*\S[\s\S]*$"`, `maxLength: 204800` | Từ chối chuỗi rỗng hoặc chỉ chứa khoảng trắng (whitespace). Giới hạn 204,800 ký tự; backend runtime kiểm tra giới hạn kích thước HTTP request body theo bytes. |
| `contractAddress` | `string` | Tùy chọn* | `pattern: "^0x[0-9a-fA-F]{40}$"` | Địa chỉ chuẩn EVM 40 hex ký tự (không được là `address(0)`). Backend kiểm tra tính hợp lệ bằng `isAddress`. |

*\*Yêu cầu logic:* Request phải có **ít nhất một trong hai trường** `sourceCode` hoặc `contractAddress`.
- Request rỗng `{}`, request chỉ có `sourceCode: ""` hoặc `sourceCode: "   "` sẽ bị từ chối với mã lỗi `400 Bad Request`.
- Bất kỳ trường nào nằm ngoài schema (`additionalProperties: false`) đều bị từ chối `400 Bad Request`.

---

## 3. Các Chế Độ Phản Hồi (Response Modes) & Cấu Trúc Dữ Liệu

Thống nhất sử dụng tên trường `targetContract` xuyên suốt giữa đặc tả và schema để biểu diễn ngữ cảnh on-chain.

### 3.1. Chế độ Source Analysis (`mode: "source-analysis"`)

`reviewWithGemini: true` là tùy chọn của request có source và đồng ý gửi mã nguồn cho provider đã cấu hình. Mặc định chỉ phân tích tĩnh. Report có `sourceDigest`, `analyzedAt`, `policy`, `reviewMode`, `scoreExplanation`, `coverage` và `limitations`; Gemini chỉ thêm nhận xét vào candidates đã có.
Áp dụng khi người dùng cung cấp `sourceCode` (kèm hoặc không kèm `contractAddress`).

- **Cấu trúc response:**
  1. `mode`: `"source-analysis"`
  2. `report`: Đối tượng snapshot chứa toàn bộ nội dung người dùng đang xem:
     - `targetContract`: Ngữ cảnh on-chain của contract mục tiêu trên Avalanche Fuji:
       - Khi có `contractAddress` và RPC thành công: `status = "available"`, `dataSource = "fuji-rpc"`, bắt buộc có `address`, `network: "Avalanche Fuji Testnet"`, `chainId: 43113`, `balanceAvax`, `isContract`, `bytecodeSize` (không âm), `queriedAt` (chuẩn ISO 8601 date-time), cùng các trường tùy chọn `owner`, `isPaused`.
       - Khi RPC không trả được dữ liệu cốt lõi: `status = "unavailable"`, `dataSource = "fuji-rpc"`, bắt buộc có `address`, `network`, `chainId`, `attemptedAt` và `warning`. Không có `queriedAt` vì chưa có kết quả truy vấn thành công; không tạo số dư hoặc trạng thái giả.
       - Khi người dùng chỉ nhập `sourceCode`: `status = "unspecified"`, `dataSource = "none"`; không có thời điểm RPC.
     - `summary`:
       - `totalVulnerabilities`, `criticalCount`, `highCount`, `mediumCount`, `lowCount`: Số nguyên không âm (`minimum: 0`).
       - `priorityScore`: **Số nguyên 0–100**. Backend dùng max của các finding `potential-issue`, hoặc 0 nếu không có. `scoredFindingCount` ghi số finding đóng góp.
     - `scoreExplanation`: Giải thích công thức, số finding đóng góp, điểm report thực tế và giới hạn Asset Impact; nằm trong snapshot được hash.
     - `findings`: Danh sách phát hiện sắp xếp giảm dần theo `priorityScore`. Mỗi finding chứa:
       - `scores`: `exploitability` (number 0..100), `exposure` (number 0..100), `assetImpact` (number 0..100), và `priorityScore` (**bắt buộc integer `0..100`**).
       - `severity`: Enum `CRITICAL` (>=80), `HIGH` (60-79), `MEDIUM` (40-59), `LOW` (0-39).
       - `evidence`: Mảng chuỗi bằng chứng cụ thể từ AST/code.
       - `confidence`: `HIGH`, `MEDIUM`, `LOW`, hoặc `INSUFFICIENT_EVIDENCE`.
       - `patchDiff`: Đề xuất vá lỗi theo chuẩn Unified Diff (gắn nhãn **AI đề xuất**).
       - `liveContext`: Ngữ cảnh rủi ro on-chain của finding:
         - Bắt buộc có `status` (`available` | `unavailable` | `unspecified`).
         - Khi `unavailable` hoặc `unspecified`: Không bắt buộc bịa giá trị `fundsAtRisk` hay booleans; có thể kèm `note`.
     - `queriedAt`: Thời điểm dữ liệu on-chain được đọc thành công. Nếu RPC lỗi, dùng `targetContract.attemptedAt`; source-only không có mốc RPC.
  3. `attestation`: Metadata ghi nhận On-Chain nằm **hoàn toàn bên ngoài `report`**:
     - `status`: `"READY_TO_ATTEST"` | `"NOT_ATTESTABLE"` | `"DISABLED"`
     - `disabledReason`: Bắt buộc khi status là `NOT_ATTESTABLE` hoặc `DISABLED` (thống nhất tên trường này trên toàn bộ hệ thống).
     - `reportHash`: Mã băm Keccak-256 (32 bytes hex `^0x[0-9a-fA-F]{64}$`). Không được là `bytes32(0)`.
     - `ipfsUri`: Chuỗi URI lưu trữ. **Lưu ý kỹ thuật:** Ràng buộc `maxLength: 512` trong JSON Schema chỉ đếm ký tự UTF-16; **backend runtime bắt buộc phải kiểm tra giới hạn <= 512 bytes UTF-8** theo đúng yêu cầu của contract [AvaTriageRegistry.sol](../contracts/contracts/AvaTriageRegistry.sol#L69-L72).

### 3.2. Điều Kiện Kích Hoạt `READY_TO_ATTEST`
Để trạng thái attestation chuyển thành `READY_TO_ATTEST`, hệ thống yêu cầu:
1. **Ràng buộc kiểm tra được bằng Schema:**
   - `report.summary.priorityScore` là số nguyên trong khoảng `0..100`.
   - `report.targetContract.address` có mặt và khác `0x0000000000000000000000000000000000000000`.
   - `attestation.reportHash` có mặt, đúng định dạng 64 ký tự hex và khác `bytes32(0)` (`0x000...000`).
   - `attestation.ipfsUri` có mặt.
2. **Ràng buộc kiểm tra tại Runtime (Frontend/Backend):**
   - Hợp đồng Registry đã được triển khai và có địa chỉ hợp lệ (`REGISTRY_ADDRESS` không rỗng và khác zero address).
   - Mạng đang kết nối là Avalanche Fuji (`Chain ID: 43113`).
   - Ví Web3 của người dùng đã kết nối.
- Nếu source-only (chưa có target address hợp lệ trên Fuji) hoặc Registry chưa được triển khai: Trạng thái bắt buộc phải là `NOT_ATTESTABLE` kèm `disabledReason`.

### 3.3. Chế độ Address-Only (`mode: "context-only"`)
Áp dụng khi người dùng **chỉ cung cấp `contractAddress`**, không có `sourceCode`.

- **Nguyên tắc bất biến:**
  - **Không giả lập AST, không giả lập findings, không giả lập điểm số rủi ro hay reportHash.** Bytecode trên chuỗi không tương đương với mã nguồn Solidity.
  - Phản hồi chứa `mode: "context-only"`, `targetContract` (với đầy đủ dữ liệu đọc từ RPC) và `attestation`:
    ```json
    {
      "mode": "context-only",
      "targetContract": { ... },
      "attestation": {
        "status": "DISABLED",
        "disabledReason": "Address-only request does not perform Solidity source code AST analysis. Bytecode is not equivalent to Solidity source, so no priorityScore or reportHash can be produced. Attestation on Avalanche Fuji is disabled by design."
      }
    }
    ```

### 3.4. Xử Lý Khi Avalanche RPC Gặp Sự Cố
- **Có `sourceCode` (kèm `contractAddress`):** Trả **HTTP 200 OK** với kết quả phân tích source đầy đủ. Trường `targetContract.status = "unavailable"`, kèm `warning`. Pillar `assetImpact` đánh giá mặc định/không xác minh.
- **Chỉ có `contractAddress`:** Trả **HTTP 502 Bad Gateway** với payload lỗi:
  ```json
  {
    "error": {
      "code": "UPSTREAM_RPC_ERROR",
      "message": "Không thể truy vấn ngữ cảnh on-chain từ Avalanche Fuji RPC (node unreachable hoặc timeout). Vui lòng thử lại sau.",
      "details": {
        "targetContract": "0x5462D6Bcf9E7C030364d276d493a7F9D0388d754",
        "chainId": 43113,
        "rpcEndpoint": "https://api.avax-test.network/ext/bc/C/rpc"
      }
    }
  }
  ```

### 3.5. Bảng Danh Mục Mã Lỗi Chuẩn Hóa (`ApiErrorResponse`)

| Mã Lỗi (`code`) | HTTP Status | Ý nghĩa |
| :--- | :---: | :--- |
| `INVALID_REQUEST` | 400 | Request thiếu cả `sourceCode` và `contractAddress`, hoặc có trường lạ ngoài schema. |
| `INVALID_JSON` | 400 | Payload JSON gửi lên bị sai cú pháp, không parse được. |
| `INVALID_ADDRESS` | 400 | Địa chỉ `contractAddress` không đúng định dạng EVM hoặc là `address(0)`. |
| `INVALID_SOURCE` | 400 | Không parse được Solidity hoặc có hơn 50 candidates. |
| `AI_MODEL_UNAVAILABLE` | 503 | Yêu cầu Gemini khi chưa cấu hình provider. |
| `FORBIDDEN_CORS` | 403 | Origin gửi request không nằm trong danh sách `CORS_ORIGIN` được phép. |
| `PAYLOAD_TOO_LARGE` | 413 | Kích thước body request vượt quá giới hạn hệ thống (250kb). |
| `RATE_LIMITED` | 429 | API đạt giới hạn theo tiến trình; RPC upstream bị rate limit vẫn là 502. |
| `UPSTREAM_RPC_ERROR` | 502 | RPC Fuji gặp sự cố/unreachable khi xử lý yêu cầu bắt buộc (address-only). |
| `RPC_TIMEOUT` | 502 | Toàn bộ ngân sách thời gian gọi RPC (10s) bị cạn kiệt. |
| `WRONG_NETWORK` | 502 | Endpoint RPC được cấu hình không phục vụ đúng mạng Avalanche Fuji (Chain ID != 43113). |
| `AI_MODEL_ERROR` | 502 | Model AI gặp sự cố hoặc trả về kết quả sai cấu trúc không thể khôi phục. |
| `INTERNAL_SERVER_ERROR` | 500 | Lỗi nội bộ không xác định từ server (tuyệt đối không để lộ stack trace hay secret). |

---

## 4. Cơ Chế Chuẩn Hóa RFC 8785 (JCS) & Keccak-256 Hashing

- **Đối tượng băm:** Toàn bộ đối tượng `report` (bao gồm `targetContract`, `summary`, `findings`, và `queriedAt`).
- **Loại trừ:** `attestation` (`reportHash`, `ipfsUri`, `status`, `disabledReason`) nằm ngoài `report`.
- **Thực thi:**
  $$\text{canonicalBytes} = \text{RFC8785\_Canonicalize}(\text{report})$$
  $$\text{reportHash} = \text{Keccak256}(\text{UTF-8}(\text{canonicalBytes}))$$
- **Lưu ý kiểm thử:** Các giá trị hash trong fixtures mẫu chỉ mang tính chất minh họa cấu trúc; không được coi là hash hợp lệ nếu chưa qua hàm tính toán JCS Keccak-256 thực tế.

---

## 5. Quy tắc điểm và trạng thái dữ liệu hiện tại

- Backend tính `Math.round((4E + 3X + 3A) / 10)` cho mỗi finding; `Math.round` làm tròn half-up với các điểm không âm. `summary.priorityScore` lấy giá trị lớn nhất trong findings có `review.verdict = "potential-issue"`, hoặc 0 nếu không có; `scoredFindingCount` cho biết số finding đóng góp. Điểm 0 khi không có finding đủ điều kiện không phải kết luận an toàn.
- Asset Impact hiện dùng 0 vì tài sản chịu rủi ro chưa được xác minh, kể cả khi RPC đọc được native balance. Xem [mô hình đề xuất](data/ASSET_IMPACT_MODEL.md); mô hình phi tuyến trong tài liệu đó chưa được runtime sử dụng.
- [mock-data.json](mock-data.json) là payload minh họa hợp schema, không phải báo cáo live hay hash có thể attest. `targetContract.dataSource`, `status`, `queriedAt` hoặc `attemptedAt` ghi provenance và trạng thái dữ liệu. `report.scoreExplanation`, `limitations` và `finding.liveContext.note` giải thích điểm và giới hạn.
- Registry Fuji đã được ghi tại [DEPLOYED_ADDRESSES.md](../contracts/DEPLOYED_ADDRESSES.md). Địa chỉ registry không khiến một báo cáo tự động đủ điều kiện ghi nhận; còn cần report, target, ví, chain và xác nhận người dùng.

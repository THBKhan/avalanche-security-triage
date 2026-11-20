# 🧠 Backend Triage Engine (`/backend`)

Engine xử lý ưu tiên lỗ hổng bảo mật Smart Contract trên Avalanche Fuji Testnet (Chain ID `43113`).

---

## 🏗️ Cấu Trúc Thư Mục

```text
backend/
├── .env.example          # Mẫu cấu hình biến môi trường an toàn (chỉ chứa placeholder)
├── package.json          # Quản lý dependencies (Express, viem, cors, dotenv)
├── tsconfig.json         # Cấu hình biên dịch TypeScript ES2022 / CommonJS
├── rules/                # Bộ Security Rules & Scorer do Alexvuong2006 phụ trách
│   ├── rules-catalog.json
│   ├── scoring-matrix.md
│   ├── system_prompt.txt
│   ├── triage-scorer.js
│   └── triage-scorer.test.js
└── src/
    ├── config.ts         # Module load & validate env (chống lộ secret trong log lỗi)
    ├── config.test.ts    # Unit tests cho parser port, URL và chống leak secret
    ├── app.ts            # Factory Express app (tách biệt server listen để test in-memory)
    ├── app.test.ts       # Integration tests cho /health và chính sách strict CORS
    ├── index.ts          # Server entry point với cơ chế graceful shutdown (SIGTERM/SIGINT)
    ├── analysis/
    │   ├── types.ts          # Định nghĩa kiểu dữ liệu facts, candidate, coverage, limitations
    │   ├── format.ts         # Tiện ích format AST type, line span (L12-L15) và slice snippet
    │   ├── parser.ts         # Module parse Solidity AST an toàn qua @solidity-parser/parser
    │   ├── analysis.test.ts  # 30 unit tests kiểm tra parser, CRLF/LF, error handling, rule evidence
    │   ├── index.ts          # Orchestrator phân tích source, trích xuất facts và draft candidates
    │   ├── rules/
    │   │   ├── catalog.ts    # Bảng tra cứu rules, coverage registry (analyzed vs unanalyzed)
    │   │   ├── pragma.ts     # Trích xuất bằng chứng RULE-PRAGMA-006 (floating vs locked pragma)
    │   │   └── tx-origin.ts  # Trích xuất bằng chứng RULE-TX-ORIGIN-003 (loại trừ EOA check)
    │   └── triage/
    │       ├── types.ts             # Schema Zod strict & types cho candidate review assessments
    │       ├── prompt.ts            # Prompt builder phiên bản hóa, đóng gói untrusted data message
    │       ├── adapter.ts           # Interface LlmAdapter & MockLlmAdapter cho kiểm thử offline
    │       ├── gemini-adapter.ts    # Adapter Google Gemini REST API (timeout AbortSignal, bounded body)
    │       ├── gemini-adapter.test.ts # Unit tests offline bằng fake fetch cho GeminiLlmAdapter
    │       ├── service.ts           # CandidateTriageService điều phối review, validate Zod & semantic
    │       └── triage.test.ts       # 17 unit tests offline kiểm tra ranh giới LLM triage
    ├── api/
    │   ├── analyze.ts    # Route handler POST /api/analyze (phân tích source hoặc đọc ngữ cảnh địa chỉ)
    │   ├── analyze.test.ts # Tests tích hợp POST /api/analyze (validate bằng schema thật)
    │   └── schema.ts     # Trình nạp và compile JSON Schema một lần (Ajv Draft 2020-12)
    ├── rpc/
    │   ├── client.ts     # Client đọc công khai Avalanche Fuji qua viem (không signer/private key)
    │   ├── client.test.ts# Unit tests cho RPC client và cơ chế inject mock transport
    │   ├── context.ts    # On-Chain Context Fetcher (đọc balance, code, owner, paused, cache isolated)
    │   ├── context.test.ts # Unit tests cho address invariant, retry, cache, cancellation, timeout
    │   └── scope.ts      # AsyncLocalStorage quản lý RequestScope và AbortController độc lập
    └── scripts/
        ├── test-rpc.ts         # CLI script kiểm tra live context Fuji an toàn (chỉ đọc)
        ├── smoke-gemini.ts     # CLI smoke test Gemini có kiểm soát (mặc định không gọi mạng)
        └── smoke-gemini.test.ts # Unit tests offline bằng fake fetch cho smoke:gemini
```

---

## ⚙️ Cấu Hình Môi Trường

Sao chép `.env.example` thành `.env`:
```bash
cp .env.example .env
```

| Biến môi trường | Mặc định | Bắt buộc? | Mô tả |
| :--- | :--- | :---: | :--- |
| `PORT` | `3001` | Không | Cổng lắng nghe HTTP Server (1–65535). |
| `FUJI_RPC_URL` | `https://api.avax-test.network/ext/bc/C/rpc` | Không | Endpoint RPC mạng Avalanche Fuji Testnet (Chain ID 43113). |
| `LLM_PROVIDER` | *(trống)* | Tùy chọn | Provider LLM sử dụng khi bật review (hiện hỗ trợ `gemini`). |
| `LLM_MODEL` | *(trống)* | Bắt buộc khi bật `LLM_PROVIDER` | Model ID khai báo rõ ràng (ví dụ `gemini-3.5-flash`). |
| `LLM_API_KEY` | *(trống)* | Bắt buộc khi bật `LLM_PROVIDER` | API key cho provider LLM (truyền qua header `x-goog-api-key`, không gắn vào URL). |
| `CORS_ORIGIN` | `http://localhost:3000` | Không | Origin được phép truy cập Dashboard (hỗ trợ phân tách bằng dấu phẩy). |

> 🔒 **Chính sách an toàn:**
> - Tuyệt đối không commit file `.env` chứa API key hoặc secret thật.
> - Khi thiếu `LLM_API_KEY`, ứng dụng vẫn khởi động và phục vụ endpoint `/health` bình thường.
> - Endpoint `/health` tuyệt đối không trả về thông tin cấu hình, secret hay stack trace.

---

## 🚀 Hướng Dẫn Cài Đặt & Khởi Chạy

Chạy trong thư mục `backend/`:

1. **Cài đặt dependencies:**
   ```bash
   npm install
   ```

2. **Kiểm tra kiểu dữ liệu (Typecheck):**
   ```bash
   npm run typecheck
   ```

3. **Chạy kiểm thử tự động:**
   ```bash
   npm test
   ```

4. **Chạy kiểm thử Security Rules:**
   ```bash
   node rules/triage-scorer.test.js
   ```

5. **Biên dịch TypeScript:**
   ```bash
   npm run build
   ```

6. **Chạy server (Development):**
   ```bash
   npm run dev
   ```

7. **Chạy server (Production):**
   ```bash
   npm start
   ```

8. **Chạy script kiểm tra live RPC (chỉ đọc):**
   ```bash
   npm run test:rpc <contractAddress>
   # Ví dụ:
   npm run test:rpc 0x5462D6Bcf9E7C030364d276d493a7F9D0388d754
   ```

---

## 📡 On-Chain Context Fetcher (`fetchOnChainContext`)

Module `src/rpc/context.ts` cung cấp hàm đọc trạng thái on-chain trên Avalanche Fuji:
- **Kiểm tra địa chỉ:** Dùng `isAddress` với `{ strict: false }`, tự động chuẩn hóa EIP-55 checksum bằng `getAddress`. Kiểm tra bất biến `normalized.toLowerCase() === input.toLowerCase()`. Từ chối địa chỉ zero (`0x000...000`) và định dạng sai bằng lỗi `INVALID_ADDRESS` mà không gọi RPC.
- **Xác thực Chain ID:** Kiểm tra `eth_chainId` **lần đầu tiên** trên mỗi reader instance và lưu cache (`verifiedChainId = 43113`). Các lần gọi sau trên cùng instance tái sử dụng chain ID đã xác minh. Endpoint sai chain bắn lỗi `WRONG_NETWORK`.
- **Số dư Native:** Đọc `eth_getBalance`, định dạng chuỗi chính xác bằng `formatEther` (không chuyển qua kiểu `Number` để tránh mất độ chính xác).
- **Bytecode & Phân loại:** Đọc `eth_getCode`. Nếu `0x` hoặc rỗng thì ghi nhận `isContract = false`, `bytecodeSize = 0` (không khẳng định chắc chắn là EOA) và bỏ qua các lệnh đọc hàm tùy chọn.
- **Đọc tùy chọn:** Thử gọi độc lập `owner()` và `paused()` qua ABI tối thiểu. Nếu contract không hỗ trợ, revert hoặc hết thời gian, trả về `null` và ghi nhận cảnh báo; không làm mất dữ liệu số dư/bytecode cốt lõi đã đọc.
- **Deadline & Cancellation thật:**
  - Mỗi lượt gọi `fetchContext` được cấp một `AbortController` riêng biệt (được cô lập luồng bất đồng bộ qua `AsyncLocalStorage`), hoàn toàn không làm ảnh hưởng lẫn nhau giữa các request đồng thời.
  - Tín hiệu abort được truyền trực tiếp xuống tầng HTTP Transport (`fetch(..., { signal })`). Khi hết thời gian, request đang gửi dở sẽ bị hủy ngay lập tức trên network.
  - *Giới hạn với injected client:* Nếu truyền client bên ngoài không hỗ trợ abort signal, reader chỉ có thể hủy qua cơ chế đua promise chứ không ép hủy được HTTP request bên dưới.
- **Độ bền RPC & Backoff:** Ngân sách tổng mặc định 10 giây cho toàn bộ tác vụ. Tham số `maxRetries` giới hạn từ `0` đến `2` (tương ứng tối đa 3 lần thử). Toàn bộ thời gian backoff lũy thừa được tính trong tổng ngân sách; không bao giờ phát sinh attempt hay retry sau khi hết deadline.
- **Cache in-memory:** Bounded FIFO cache (tối đa 500 entries) với TTL 30 giây được cô lập theo reader instance và chain ID (`${chainId}:${lowercaseAddress}`). Cache hit bảo toàn nguyên vẹn `queriedAt` ban đầu và trả về bản clone bảo vệ chống mutation.
- **Lưu ý tích hợp API:** Wrapper hàm `fetchOnChainContext` sẽ tạo một reader mới khi truyền options riêng biệt. Khi tích hợp vào tầng HTTP API sau này, cần khởi tạo và tái sử dụng một `OnChainContextReader` dùng chung theo cấu hình server để cache phát huy hiệu quả.

---

## 📡 API Endpoints Hiện Có

- `GET /health`: Kiểm tra trạng thái hoạt động của service.
  - Phản hồi: `200 OK`
  ```json
  {
    "status": "ok",
    "timestamp": "2026-11-17T16:00:00.000Z"
  }
  ```
  - Không gọi LLM hay RPC bên ngoài.
  - Áp dụng chính sách CORS nghiêm ngặt theo `CORS_ORIGIN`.

- `POST /api/analyze`: Endpoint phân tích lỗ hổng & ngữ cảnh on-chain.
  - **Nhánh Address-Only (Đã hoàn thiện):**
    ```bash
    curl -X POST http://localhost:3001/api/analyze \
      -H "Content-Type: application/json" \
      -d '{"contractAddress": "0x5462D6Bcf9E7C030364d276d493a7F9D0388d754"}'
    ```
    Phản hồi `200 OK`:
    ```json
    {
      "mode": "context-only",
      "targetContract": {
        "address": "0x5462d6Bcf9E7C030364D276d493A7F9D0388d754",
        "network": "Avalanche Fuji Testnet",
        "chainId": 43113,
        "balanceAvax": "0",
        "isContract": false,
        "bytecodeSize": 0,
        "owner": null,
        "isPaused": null,
        "queriedAt": "2026-11-17T15:00:00.000Z",
        "status": "available"
      },
      "attestation": {
        "status": "DISABLED",
        "disabledReason": "Address-only request: On-chain context retrieved without source code analysis or priority score."
      }
    }
    ```
  - **Nhánh Source Analysis:**
    - Trả report đã lưu kèm Keccak-256 hash. Có thể bật Gemini theo từng yêu cầu khi backend đã cấu hình provider.
  - Xem chi tiết toàn bộ các trường hợp request/response và mã lỗi tại [docs/api-examples.md](../docs/api-examples.md).

---

## 🔍 Module Phân Tích AST & Trích Xuất Bằng Chứng (`src/analysis`)

Module `src/analysis` cung cấp công cụ phân tích tĩnh Solidity AST độc lập với Express, RPC và LLM model:
- **Parser an toàn & Giới hạn:** Sử dụng `@solidity-parser/parser` trong bộ nhớ Node.js để phân tích cú pháp Solidity tiêu chuẩn; không yêu cầu binary `solc`, không thực thi code, không deploy contract, không tải import từ mạng hay đọc đường dẫn do source chỉ định. Giới hạn: parser chỉ phân tích cú pháp trong phạm vi hỗ trợ của thư viện; chưa resolve imports bên ngoài, chưa type-check hoặc biên dịch toàn bộ chương trình.
- **Single Source of Truth:** Nạp metadata rules động từ `backend/rules/rules-catalog.json` (kiểm tra schema khi load, tự động đồng bộ vào `dist/rules/` khi build, không duy trì bản sao thủ công).
- **Trích xuất sự kiện cấu trúc (`SourceFacts`):**
  - Thông tin pragma: phát hiện phiên bản, phân biệt pragma thả nổi/khoảng dải (`isFloating = true`) với pragma cố định.
  - Thông tin imports: ghi nhận các đường dẫn import dưới dạng `unresolved: true` và đưa vào danh sách `limitations`.
  - Hợp đồng/Interface/Library: tên, loại (`contract`, `interface`, `library`), base contracts kế thừa, modifiers khai báo.
  - Hàm & hàm đặc biệt: phân biệt chính xác `constructor`, `receive`, `fallback` và hàm thông thường; trích xuất chữ ký đầy đủ, visibility (giữ nguyên `"default"` nếu không khai báo rõ ràng, không tự ý chuyển thành `"public"`), stateMutability, modifiers, line span và range offsets.
- **Trích xuất bằng chứng Rules:**
  - `RULE-PRAGMA-006` (Floating Pragma): Phát hiện dải phiên bản (`^`, `>=`, `>`, `<=`, `<`, `~`, `-`); không tạo candidate khi pragma cố định (ví dụ `0.8.20`); chỉ ghi nhận cú pháp dải phiên bản, không suy đoán compiler có lỗ hổng.
  - `RULE-TX-ORIGIN-003` (Authorization via tx.origin):
    - Nhận diện chính xác hàm overload bằng byte range trong cùng contract; mỗi candidate mang chữ ký hàm riêng biệt và visibility/modifiers độc lập.
    - Phát hiện sự hiện diện của `tx.origin` trong điều kiện rẽ nhánh (`require(...)`, `assert(...)`, `if (...)`).
    - Bỏ qua các khối `if` thuần túy ghi log (ví dụ: `if (tx.origin != address(0)) { emit Seen(); }`).
    - Loại trừ chính xác mẫu kiểm tra EOA: `tx.origin == msg.sender` / `msg.sender == tx.origin` / `!=`.
    - Bỏ qua comment và chuỗi literal.
    - Mức độ kết luận chuẩn mực: Ghi nhận trung tính quan sát AST có `tx.origin` trong luồng điều khiển; không tự khẳng định đã có lỗ hổng authorization khi chưa xác minh ngữ nghĩa nghiệp vụ. Độ tin cậy gán `MEDIUM` (hoặc `LOW` cho helper call) kèm ghi chú limitation rõ ràng.
- **Đồng bộ hóa Bằng chứng (Evidence Invariant):**
  - Mọi trường `snippet`, `range`, `location`, `lines` trong `evidence` đều bắt nguồn từ cùng một node gốc (`containerNode`).
  - Luôn bảo đảm bất biến: `sourceCode.slice(range[0], range[1] + 1) === snippet` cho mọi candidate (bao gồm điều kiện nhiều dòng, LF, CRLF và Unicode).
  - Biểu thức con (nếu có) được tách riêng trong trường `expression` với range/location độc lập, không trộn lẫn.
- **Cấu trúc dữ liệu nội bộ (`SourceAnalysisDraft`):**
  - `sourceFacts`: Facts AST đã trích xuất.
  - `candidates`: Danh sách phát hiện sơ bộ kèm bằng chứng trích xuất.
  - `coverage`: Phân tách trung tính các checks đã có trong module (`RULE-PRAGMA-006`, `RULE-TX-ORIGIN-003`) và các checks chưa triển khai (`RULE-REENTRANCY-001`, `RULE-ACCESS-002`, `RULE-UNCHECKED-CALL-004`, `RULE-DELEGATECALL-005`).
  - `limitations`: Ghi nhận trung tính các giới hạn (chưa resolve import ngoài, chưa type-check/biên dịch toàn bộ chương trình, chưa chạy phân tích ngữ nghĩa, chưa gán điểm).
  - **Không** tự gán `priorityScore`, `severity`, hay tạo `reportHash` ở giai đoạn này.
- **Xử lý lỗi cú pháp có cấu trúc:** Khi source code sai cú pháp Solidity, hàm `analyzeSoliditySource` bắt lỗi và trả về `{ ok: false, error: { code: "SYNTAX_ERROR", message, line, column, details } }`, không để unhandled exception crash tiến trình. Hàm `parseSoliditySource` ném `SolidityParseError` có cấu trúc cho các tác vụ cần try/catch rõ ràng.

---

## 🤖 Ranh Giới Tích Hợp LLM Triage (`src/analysis/triage`)

Module `src/analysis/triage` thiết lập ranh giới kiểm soát an toàn cho bước review candidates:
- **Nguyên tắc dữ liệu không tin cậy:** Mã nguồn Solidity, chú thích, chuỗi literal, tên hàm và candidate notes đều được đóng gói nghiêm ngặt trong payload `dataMessage` dưới dạng JSON có cấu trúc. System instructions được bảo vệ trong `systemPrompt` riêng biệt (phiên bản `2026-11-candidate-review-v1.1`), cảnh báo chống prompt injection và cấm sinh mã PoC khai thác hoặc gọi tools ngoài.
- **Contract đánh giá nội bộ:** Mô hình chỉ review các candidates do tầng static cấp (`candidateId: cand-0, cand-1...`). Verdict chỉ cho phép `potential-issue`, `dismissed`, hoặc `needs-review` (tuyệt đối không dùng `confirmed` để ngụ ý đã chứng minh lỗ hổng). Không cho phép mô hình sinh ra `priorityScore`, `severity`, hay `reportHash`.
- **Validation bằng Zod Strict:** Phân tích JSON bằng `JSON.parse` (không dùng `eval`), áp dụng Zod `.strict()` để từ chối mọi trường lạ hoặc vượt giới hạn dung lượng/độ dài chuỗi.
- **Kiểm tra ngữ nghĩa & Bảo toàn dữ kiện:**
  - `candidateId` phải tồn tại trong tập candidates backend cấp, không được trùng lặp.
  - `evidenceReferences` phải trỏ đúng vào key bằng chứng hợp lệ (`primary`, `expression`).
  - Mô hình không được phép ghi đè chữ ký hàm, vị trí dòng, hay dữ kiện on-chain từ RPC.
  - Candidate nào bị mô hình bỏ sót sẽ được gắn trạng thái `unreviewed` rõ ràng, không âm thầm coi như `dismissed`.
  - Trường hợp 0 candidates không được suy diễn thành "contract an toàn".
- **Gemini Adapter (`src/analysis/triage/gemini-adapter.ts`):**
  - Triển khai `LlmAdapter` gọi endpoint HTTPS cố định của Google Gemini (`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`) với `redirect: "error"`. Gửi `systemPrompt` vào `systemInstruction`, `dataMessage` vào `contents`, đặt `generationConfig.responseMimeType = "application/json"`, không bật `tools`/`toolConfig`.
  - Truyền API key qua header `x-goog-api-key` (không gắn vào URL).
  - Bỏ qua các `parts` có `thought: true` khi trích JSON cuối; vẫn áp dụng đầy đủ Zod strict và kiểm tra candidate/evidence references tại `CandidateTriageService`.
  - Yêu cầu khai báo rõ ràng cả 3 biến trong `.env`:
    ```env
    LLM_PROVIDER=gemini
    LLM_MODEL=<model-id-ro-rang>
    LLM_API_KEY=<your-gemini-api-key>
    ```
    (Không hardcode model mặc định; `createLlmAdapterFromConfig` sẽ trả `LLM_ADAPTER_NOT_CONFIGURED` nếu thiếu `LLM_MODEL` hoặc `LLM_API_KEY`.)
  - Có timeout hủy HTTP thật qua `AbortSignal`, giới hạn dung lượng response theo byte (`maxResponseBytes`), không tự động retry request model, và ánh xạ an toàn cho HTTP 429 (`LLM_RATE_LIMITED`), 401/403 (`LLM_AUTH_ERROR`), 5xx (`LLM_HTTP_ERROR`), phản hồi trống (`LLM_EMPTY_RESPONSE`), bị chặn (`LLM_BLOCKED`), hoặc bị cắt (`LLM_TRUNCATED_RESPONSE`).
- **Smoke Test Gemini Có Kiểm Soát (`npm run smoke:gemini`):**
  - **Chế độ mặc định (không gọi mạng / dry-run):**
    ```bash
    npm run smoke:gemini
    ```
  - **Chạy live (gửi đúng 1 request với source cố định `pragma solidity ^0.8.20; contract Demo {}`):**
    ```bash
    npm run smoke:gemini -- --live
    ```
  - Script không nhận đường dẫn file, source tùy ý hay địa chỉ ví từ CLI; chỉ in model ID, số candidate đã review, thời gian thực thi và kết quả (`PASS` / `FAIL` / `DRY_RUN`), tuyệt đối không in API key, prompt, source hay response thô.
  - Chỉ `PASS` khi candidate floating pragma (`RULE-PRAGMA-006`) có assessment hợp lệ và `evidenceReferences` khớp; trường hợp JSON hợp lệ nhưng bỏ sót candidate sẽ bị báo `FAIL (MISSING_ASSESSMENT)`.
- **Chống lộ thông tin lỗi:** `CandidateTriageService` không bao giờ echo `err.message` thô từ adapter và không echo key/value/ID/evidenceRef do model trả về trong thông báo lỗi hay mảng `issues`.
- **Kiểm thử Gemini:** Unit test dùng `MockLlmAdapter` và fake `fetch`. `smoke:gemini -- --live` và `POST /api/analyze` đã chạy thành công với `LLM_MODEL=gemini-3.5-flash-lite`. API phân tích tĩnh hoạt động kể cả khi provider chưa cấu hình.

Xem [hướng dẫn demo và triển khai](../docs/DEMO.md) để cấu hình registry Fuji và thư mục lưu snapshot.

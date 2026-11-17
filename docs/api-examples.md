# 📡 API Examples (`POST /api/analyze`)

Tài liệu đặc tả các mẫu yêu cầu (Request) và phản hồi (Response) thực tế của endpoint `POST /api/analyze` trên Avalanche Security Triage Backend (Fuji Testnet, Chain ID `43113`).

---

## 1. Yêu Cầu Chỉ Có Địa Chỉ (Address-Only Request) - Thành Công (HTTP 200)

Khi chỉ cung cấp `contractAddress`, hệ thống chỉ truy vấn và trả về ngữ cảnh on-chain từ RPC Fuji. Tuyệt đối không giả lập AST, lỗ hổng, điểm số hoặc băm báo cáo. Tính năng attestation bị vô hiệu hóa (`DISABLED`).

### Request
```http
POST /api/analyze HTTP/1.1
Host: localhost:3001
Content-Type: application/json

{
  "contractAddress": "0x5462D6Bcf9E7C030364d276d493a7F9D0388d754"
}
```

### Response (`200 OK`)
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

*Ghi chú: Nếu contract có bytecode và các hàm tùy chọn `owner()` hoặc `paused()` bị revert/timeout, trường `warning` sẽ xuất hiện trong `targetContract`, dữ liệu cốt lõi vẫn được bảo toàn và trả về HTTP 200.*

---

## 2. Yêu Cầu Có Mã Nguồn (Tạm Thời Chưa Triển Khai) - HTTP 501

Trong giai đoạn này (chưa triển khai Bước 13), bất kỳ yêu cầu nào chứa `sourceCode` (kể cả source-only hay source kèm address) đều được validate cú pháp hợp lệ và trả về tạm thời mã HTTP 501 `SOURCE_ANALYSIS_NOT_IMPLEMENTED`. Không bỏ qua source để trả về giả lập context-only.

### Request
```http
POST /api/analyze HTTP/1.1
Host: localhost:3001
Content-Type: application/json

{
  "sourceCode": "pragma solidity ^0.8.20; contract Vault { address public owner; }",
  "contractAddress": "0x5462D6Bcf9E7C030364d276d493a7F9D0388d754"
}
```

### Response (`501 Not Implemented`)
```json
{
  "error": {
    "code": "SOURCE_ANALYSIS_NOT_IMPLEMENTED",
    "message": "Source code analysis is not yet implemented at this development phase",
    "details": {
      "note": "Temporary 501 response during incremental development. Use address-only requests for on-chain context triage."
    }
  }
}
```

---

## 3. Các Trường Hợp Lỗi Phổ Biến

### 3.1. Lỗi Cú Pháp JSON (`400 Bad Request`)
```json
{
  "error": {
    "code": "INVALID_JSON",
    "message": "Malformed JSON payload in request body"
  }
}
```

### 3.2. Payload Quá Kích Thước (`413 Payload Too Large`)
Khi HTTP body vượt quá giới hạn cấu hình `250kb`:
```json
{
  "error": {
    "code": "PAYLOAD_TOO_LARGE",
    "message": "Request payload exceeds size limit (250kb)"
  }
}
```

### 3.3. Dữ Liệu Sai Schema (`400 Bad Request`)
Ví dụ: gửi payload rỗng `{}`, `sourceCode` rỗng, hoặc chứa trường ngoài schema (`additionalProperties: false`):
```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Request payload does not match schema requirements",
    "details": {
      "issues": [
        {
          "path": "/",
          "message": "must match a schema in anyOf"
        }
      ]
    }
  }
}
```
*(Tuyệt đối không phản hồi echo nội dung raw body, source code hay secret trong `details`).*

### 3.4. Địa Chỉ Zero Address (`400 Bad Request`)
Khi gửi địa chỉ `0x0000000000000000000000000000000000000000`:
```json
{
  "error": {
    "code": "INVALID_ADDRESS",
    "message": "Invalid Avalanche Fuji contract address: zero address is not allowed"
  }
}
```

### 3.5. Lỗi RPC Fuji Từ Upstream (`502 Bad Gateway`)
Khi node RPC Fuji bị timeout, rate limit (HTTP 429 từ node provider), sai chain ID, hoặc không thể kết nối:
```json
{
  "error": {
    "code": "UPSTREAM_RPC_ERROR",
    "message": "Failed to query on-chain context from Avalanche Fuji RPC",
    "details": {
      "reason": "RPC_TIMEOUT"
    }
  }
}
```
*Ghi chú: `details.reason` là một trong các mã an toàn: `RPC_TIMEOUT`, `RATE_LIMITED`, `WRONG_NETWORK`, `RPC_ERROR`, `REVERT`.*

### 3.6. Lỗi Bất Ngờ Từ Hệ Thống (`500 Internal Server Error`)
```json
{
  "error": {
    "code": "INTERNAL_SERVER_ERROR",
    "message": "An internal server error occurred"
  }
}
```
*(Tuyệt đối không trả về stack trace, biến môi trường, chuỗi URL nhạy cảm hay thông tin nội bộ).*

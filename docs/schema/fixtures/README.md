# 📁 Thư Mục Fixtures Schema (`docs/schema/fixtures`)

Thư mục này chứa các dữ liệu mẫu (fixtures) dùng để kiểm thử tính hợp lệ của schema API `POST /api/analyze` theo chuẩn JSON Schema draft 2020-12.

> ⚠️ **LƯU Ý QUAN TRỌNG VỀ TÍNH CHẤT DỮ LIỆU MINH HỌA:**
> 1. **Kiểm tra cấu trúc, không phải bằng chứng hash:** Các giá trị `reportHash` trong fixtures (nếu có) chỉ là chuỗi placeholder 32-byte hex (`0x...`) hợp lệ về mặt định dạng schema. Chúng **chưa được tính toán hay xác thực bằng RFC 8785 (JCS) và Keccak-256 thật**. Tuyệt đối không dùng các hash này làm bằng chứng kiểm thử hash hoặc dùng để kích hoạt giao dịch attestation trên blockchain.
> 2. **Trạng thái Attestation:** Registry hiện đã triển khai trên Fuji, nhưng fixture vẫn chỉ minh họa nhánh schema; `READY_TO_ATTEST` trong fixture không cho phép gửi giao dịch bằng hash placeholder.
> 3. **`docs/mock-data.json`:** Payload demo đã được cập nhật theo schema, minh họa nhánh source có lỗi RPC. Xem [ghi chú provenance](../../data/README.md).

---

## Danh Mục Fixtures

| Tên File | Chế độ (Mode) | Trạng thái HTTP | Mục đích kiểm thử |
| :--- | :--- | :---: | :--- |
| `illustrative-integer-source-analysis.json` | `source-analysis` | 200 OK | Phân tích source minh họa với `priorityScore` nguyên; trạng thái `NOT_ATTESTABLE` là dữ liệu fixture cũ, không mô tả trạng thái deploy hiện tại. |
| `illustrative-ready-to-attest.json` | `source-analysis` | 200 OK | Kiểm tra nhánh schema `READY_TO_ATTEST` khi có đủ target address, score nguyên và reportHash hợp lệ về mặt cấu trúc. |
| `context-only-response.json` | `context-only` | 200 OK | Nhập address-only: Chỉ trả ngữ cảnh on-chain, không có AST/findings/score/hash. Trạng thái `DISABLED`. |
| `source-with-rpc-error-200.json` | `source-analysis` | 200 OK | Có source nhưng RPC lỗi: Trả phân tích source, `targetContract.status = "unavailable"`, không bịa `fundsAtRisk`. |
| `address-rpc-error-502.json` | Error | 502 Bad Gateway | Chỉ có address nhưng RPC lỗi: Trả mã `UPSTREAM_RPC_ERROR`. |

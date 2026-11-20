# 📁 Thư Mục Fixtures Schema (`docs/schema/fixtures`)

Thư mục này chứa các dữ liệu mẫu (fixtures) dùng để kiểm thử tính hợp lệ của schema API `POST /api/analyze` theo chuẩn JSON Schema draft 2020-12.

> ⚠️ **LƯU Ý QUAN TRỌNG VỀ TÍNH CHẤT DỮ LIỆU MINH HỌA:**
> 1. **Kiểm tra cấu trúc, không phải bằng chứng hash:** Các giá trị `reportHash` trong fixtures (nếu có) chỉ là chuỗi placeholder 32-byte hex (`0x...`) hợp lệ về mặt định dạng schema. Chúng **chưa được tính toán hay xác thực bằng RFC 8785 (JCS) và Keccak-256 thật**. Tuyệt đối không dùng các hash này làm bằng chứng kiểm thử hash hoặc dùng để kích hoạt giao dịch attestation trên blockchain.
> 2. **Trạng thái Attestation:** Dữ liệu demo khi chưa có contract Registry triển khai trên Avalanche Fuji hoặc chưa có đầy đủ thông tin hợp lệ bắt buộc phải mang trạng thái `NOT_ATTESTABLE` hoặc `DISABLED`.
> 3. **Phân biệt với `docs/mock-data.json`:** File `docs/mock-data.json` ở thư mục ngoài là dữ liệu nháp ban đầu của nhóm (chứa score thập phân và chưa có công thức tổng hợp điểm). Các fixtures trong thư mục này được chuẩn hóa để đối chiếu và kiểm tra schema mới.

---

## Danh Mục Fixtures

| Tên File | Chế độ (Mode) | Trạng thái HTTP | Mục đích kiểm thử |
| :--- | :--- | :---: | :--- |
| `illustrative-integer-source-analysis.json` | `source-analysis` | 200 OK | Phân tích source thành công với `priorityScore` nguyên. Trạng thái `NOT_ATTESTABLE` do Registry chưa deploy. |
| `illustrative-ready-to-attest.json` | `source-analysis` | 200 OK | Kiểm tra nhánh schema `READY_TO_ATTEST` khi có đủ target address, score nguyên và reportHash hợp lệ về mặt cấu trúc. |
| `context-only-response.json` | `context-only` | 200 OK | Nhập address-only: Chỉ trả ngữ cảnh on-chain, không có AST/findings/score/hash. Trạng thái `DISABLED`. |
| `source-with-rpc-error-200.json` | `source-analysis` | 200 OK | Có source nhưng RPC lỗi: Trả phân tích source, `targetContract.status = "unavailable"`, không bịa `fundsAtRisk`. |
| `address-rpc-error-502.json` | Error | 502 Bad Gateway | Chỉ có address nhưng RPC lỗi: Trả mã `UPSTREAM_RPC_ERROR`. |

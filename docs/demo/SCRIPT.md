# Kịch bản video demo

[Video demo](avalanche-security-triage-demo.mp4) ghi màn hình dashboard, MetaMask và Snowtrace trong Microsoft Edge, có phụ đề tiếng Việt.

| Thời gian | Thao tác trên màn hình |
|---|---|
| 00:00–00:14 | Bấm **Thử dữ liệu mẫu**, rồi bấm **Phân tích** để chạy API tĩnh trên source mẫu. |
| 00:14–00:33 | Dán mã `DemoGuard` vào ô mã Solidity, giữ ô địa chỉ trống và bật Gemini review. Mở finding có verdict `potential-issue`, điểm 60. Nút ghi nhận khóa vì source chưa gắn với contract đã deploy trên Fuji. |
| 00:33–00:42 | Xóa source và tra cứu riêng registry. Dashboard hiển thị số dư AVAX và bytecode 3030 B đọc qua RPC Fuji. |
| 00:42–00:52 | Mở hộp thoại **Xác nhận smoke test Fuji**, đối chiếu địa chỉ, điểm và hash rồi mở yêu cầu ký trong MetaMask. |
| 00:52–01:05 | Mở kết quả của lượt đã ký trước đó. Dashboard báo **Registry đã ghi nhận smoke test**. Bấm **Xem giao dịch**, xem **Success** trên Snowtrace rồi mở **Logs** để đối chiếu hash của attestation ID `1`. |

Trước khi quay, kiểm tra backend, dashboard, cấu hình Gemini và registry. Mở sẵn [giao dịch smoke đã ký từ dashboard](https://testnet.snowtrace.io/tx/0x9a6b13c4fdbdcd50dd8423573ef158e01cf8d544c8f8b498ddbb34a08ea80473). Với cảnh ký ví, chạy thử toàn bộ luồng bằng báo cáo smoke của registry hoặc báo cáo đủ điều kiện ghi nhận.

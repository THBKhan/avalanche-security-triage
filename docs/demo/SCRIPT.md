# Kịch bản demo 54 giây

[Video demo 0:54](avalanche-security-triage-demo.mp4) ghi màn hình dashboard và Snowtrace trong Microsoft Edge, có phụ đề ngắn. Khung MetaMask được đóng trong lần quay này.

| Thời gian | Thao tác trên màn hình |
|---|---|
| 00:00–00:14 | Bấm **Thử dữ liệu mẫu**, rồi bấm **Phân tích** để chạy API tĩnh trên source mẫu. |
| 00:14–00:33 | Dán mã `DemoGuard` vào ô mã Solidity, giữ ô địa chỉ trống và bật Gemini review. Mở finding có verdict `potential-issue`, điểm 60. Nút ghi nhận khóa vì source chưa gắn với contract đã deploy trên Fuji. |
| 00:33–00:42 | Xóa source và tra cứu riêng registry. Dashboard hiển thị số dư AVAX và bytecode 3030 B đọc qua RPC Fuji. |
| 00:42–00:54 | Dashboard báo **Registry đã ghi nhận smoke test** cho giao dịch đã ký qua MetaMask. Bấm **Xem giao dịch**, xem **Success** trên Snowtrace rồi mở **Logs** để đối chiếu hash của attestation ID `1`. |

Trước khi quay, kiểm tra backend, dashboard, cấu hình Gemini và registry. Mở sẵn [giao dịch smoke đã ký từ dashboard](https://testnet.snowtrace.io/tx/0x9a6b13c4fdbdcd50dd8423573ef158e01cf8d544c8f8b498ddbb34a08ea80473). Với cảnh ký ví, chạy thử toàn bộ luồng bằng báo cáo smoke của registry hoặc báo cáo đủ điều kiện ghi nhận.

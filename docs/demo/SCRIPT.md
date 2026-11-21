# Kịch bản video demo

[Video demo](avalanche-security-triage-demo.mp4) ghi màn hình dashboard, MetaMask và Snowtrace trong Microsoft Edge, có phụ đề tiếng Việt.

| Thời gian | Thao tác trên màn hình |
|---|---|
| 00:00–00:14 | Bấm **Thử dữ liệu mẫu**, rồi bấm **Phân tích** để chạy API tĩnh trên source mẫu. |
| 00:14–00:33 | Dán mã `DemoGuard` vào ô mã Solidity, giữ ô địa chỉ trống và bật Gemini review. Mở finding có verdict `potential-issue`, điểm 60. Nút ghi nhận khóa vì source chưa gắn với contract đã deploy trên Fuji. |
| 00:33–00:42 | Xóa source và tra cứu riêng registry. Dashboard hiển thị số dư AVAX và bytecode 3030 B đọc qua RPC Fuji. |
| 00:42–00:53 | Mở hộp thoại **Xác nhận smoke test Fuji**, đối chiếu địa chỉ, điểm và hash, rồi bấm **Confirm** trong MetaMask. |
| 00:53–01:07 | Dashboard báo **Registry đã ghi nhận smoke test**. Bấm **Xem giao dịch**, xem **Success** trên Snowtrace rồi mở **Logs** để đối chiếu hash của cùng giao dịch, attestation ID `2`. |

Trước khi quay, kiểm tra backend, dashboard, cấu hình Gemini và registry. Video dùng báo cáo tĩnh của registry để kiểm thử chữ ký ví và đối chiếu receipt. [Giao dịch smoke test trong video](https://testnet.snowtrace.io/tx/0x35ba960515587bf1ab1e974eac7bef5a2184f88c5a2be3529a40ee4ce6b10e23).

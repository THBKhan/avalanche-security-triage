# 📋 Tài Liệu Tích Hợp On-Chain Registry (AvaTriageRegistry)

> **Mục tiêu:** Đặc tả giao diện contract, chữ ký hàm, ràng buộc dữ liệu thực tế, và quy tắc tích hợp Web3 Attestation cho hệ thống Avalanche Security Triage trên Avalanche Fuji Testnet.  
> **Người phụ trách:** THBKhan (SE Lead) phối hợp với Alexvuong2006 (InfoSec Lead).  
> **Trạng thái:** Chờ xác nhận địa chỉ deploy Fuji và quy tắc làm tròn điểm nguyên.

---

## 1. Chữ Ký Hàm và Thứ Tự Tham Số

Hàm ghi nhận attestation được định nghĩa trong contract [AvaTriageRegistry.sol](file:///C:/Users/Admin/avalanche-security-triage/contracts/contracts/AvaTriageRegistry.sol#L47-L59) và ABI [AvaTriageRegistry.json](file:///C:/Users/Admin/avalanche-security-triage/contracts/abi/AvaTriageRegistry.json#L320-L352):

```solidity
function recordAttestation(
    address targetContract,
    bytes32 reportHash,
    uint256 priorityScore,
    string calldata ipfsUri
) external returns (uint256 attestationId)
```

### Thứ tự và kiểu dữ liệu của các tham số:
1. `targetContract` (`address`): Địa chỉ của smart contract mục tiêu được đánh giá bảo mật trên Avalanche Fuji.
2. `reportHash` (`bytes32`): Mã băm Keccak-256 của snapshot báo cáo đã được chuẩn hóa theo RFC 8785 (JSON Canonicalization Scheme) mã hóa UTF-8.
3. `priorityScore` (`uint256`): Điểm ưu tiên rủi ro tổng hợp (Tri-Pillar Priority Score), thang điểm chuẩn hóa từ `0` đến `100`.
4. `ipfsUri` (`string`): Chuỗi URI trỏ tới dữ liệu lưu trữ mở rộng (IPFS/Arweave), tối đa 512 bytes.

---

## 2. Ràng Buộc Kỹ Thuật Dựa Trên Code Thực Tế

Dựa trên mã nguồn tại [AvaTriageRegistry.sol](file:///C:/Users/Admin/avalanche-security-triage/contracts/contracts/AvaTriageRegistry.sol#L60-L75):

| Tham số / Trạng thái | Ràng buộc trong code | Custom Error khi vi phạm | Bằng chứng mã nguồn |
| :--- | :--- | :--- | :--- |
| `targetContract` | Không được là `address(0)` | `error ZeroAddress()` | [AvaTriageRegistry.sol#L60-L62](file:///C:/Users/Admin/avalanche-security-triage/contracts/contracts/AvaTriageRegistry.sol#L60-L62) |
| `reportHash` | Không được là `bytes32(0)` | `error InvalidReportHash()` | [AvaTriageRegistry.sol#L63-L65](file:///C:/Users/Admin/avalanche-security-triage/contracts/contracts/AvaTriageRegistry.sol#L63-L65) |
| `priorityScore` | Phải là số nguyên `0 <= priorityScore <= 100` (`MAX_PRIORITY_SCORE = 100`) | `error InvalidPriorityScore(uint256 score)` | [AvaTriageRegistry.sol#L66-L68](file:///C:/Users/Admin/avalanche-security-triage/contracts/contracts/AvaTriageRegistry.sol#L66-L68) |
| `ipfsUri` | Chiều dài bytes không vượt quá `512` (`MAX_IPFS_URI_LENGTH = 512`). **Cho phép chuỗi rỗng `""`** (không có kiểm tra độ dài tối thiểu trong Solidity) | `error IpfsUriTooLong(uint256 length, uint256 maxLength)` | [AvaTriageRegistry.sol#L69-L72](file:///C:/Users/Admin/avalanche-security-triage/contracts/contracts/AvaTriageRegistry.sol#L69-L72) |
| Chống lặp (Idempotency) | Cùng một `msg.sender` (auditor) không được attest trùng lặp cùng một bộ `(targetContract, reportHash)` | `error DuplicateAttestation(address auditor, address targetContract, bytes32 reportHash)` | [AvaTriageRegistry.sol#L73-L75](file:///C:/Users/Admin/avalanche-security-triage/contracts/contracts/AvaTriageRegistry.sol#L73-L75) |

### Quyền gọi (Caller Permissions):
- Hàm có phạm vi `external`, không giới hạn quyền admin (`onlyOwner`). Bất kỳ ai sở hữu ví Web3 đều có thể ký giao dịch ghi nhận báo cáo. Địa chỉ ký được lưu tự động thành `auditor = msg.sender`.
- Các auditor khác nhau được phép cùng gửi attestation cho cùng một `targetContract` và `reportHash`.

### Event phát ra:
Khi ghi nhận thành công, contract phát ra event:
```solidity
event AttestationRecorded(
    uint256 indexed attestationId,
    address indexed targetContract,
    address indexed auditor,
    bytes32 reportHash,
    uint256 priorityScore,
    string ipfsUri,
    uint256 timestamp
);
```
*(Bằng chứng: [AvaTriageRegistry.sol#L94-L102](file:///C:/Users/Admin/avalanche-security-triage/contracts/contracts/AvaTriageRegistry.sol#L94-L102))*

---

## 3. Trạng Thái Triển Khai Trên Avalanche Fuji

Theo tài liệu hiện có tại [DEPLOYED_ADDRESSES.md](file:///C:/Users/Admin/avalanche-security-triage/contracts/DEPLOYED_ADDRESSES.md#L14-L17):
- **Trạng thái:** `Pending deployment` (Chưa deploy lên Avalanche Fuji Testnet).
- **Địa chỉ Registry:** Chưa có địa chỉ hợp lệ được xác minh.
- **Fuji Chain ID:** `43113`.
- **Fuji RPC URL:** `https://api.avax-test.network/ext/bc/C/rpc`.
- **Explorer:** `https://testnet.snowtrace.io/` (Lưu ý: Đây là cấu hình tài liệu được ghi nhận trong repo, **chưa được coi là đã xác minh live** vì chưa có contract/tx thực tế).

### Quy tắc an toàn bắt buộc khi thiếu địa chỉ:
1. **Tuyệt đối không tạo địa chỉ giả làm fallback** trong cấu hình ứng dụng (`NEXT_PUBLIC_REGISTRY_ADDRESS` không được gán địa chỉ tùy tiện).
2. Khi `NEXT_PUBLIC_REGISTRY_ADDRESS` trống hoặc chưa được xác nhận, nút **“Attest on Avalanche Fuji”** trên Frontend **phải bị vô hiệu hóa hoàn toàn (disabled)** và hiển thị thông báo rõ ràng cho người dùng:
   > *"Nút Attest bị vô hiệu hóa: Contract Registry chưa được triển khai hoặc chưa được cấu hình địa chỉ hợp lệ trên Avalanche Fuji."*
3. Địa chỉ mock/giả định chỉ được phép xuất hiện trong test cô lập của hardhat hoặc chế độ mock frontend được gắn nhãn minh bạch.

---

## 4. Tình Trạng Kiểm Thử Runtime Của Contract

- **Kết quả chạy test cục bộ (`cd contracts; npm test`):**
  - Lệnh thất bại với lỗi: `'hardhat' is not recognized as an internal or external command`.
  - **Nguyên nhân kỹ thuật:** Thư mục `contracts/node_modules` chưa tồn tại trong môi trường; các gói dependency trong `package.json` chưa được cài đặt.
  - **Đánh giá:** Đây là lỗi môi trường/thiếu dependency, **không phải lỗi logic assertion của hợp đồng thông minh**.
- **Về tính năng `ipfsUri` rỗng:**
  - Về mặt cú pháp và logic mã nguồn Solidity tại [AvaTriageRegistry.sol#L69-L72](file:///C:/Users/Admin/avalanche-security-triage/contracts/contracts/AvaTriageRegistry.sol#L69-L72), contract hoàn toàn chấp nhận chuỗi rỗng `""` vì `bytes("").length == 0 <= 512`.
  - File test [AvaTriageRegistry.test.ts#L48-L56](file:///C:/Users/Admin/avalanche-security-triage/contracts/test/AvaTriageRegistry.test.ts#L48-L56) có viết kịch bản kiểm tra `allows empty ipfsUri and boundary scores 0 and 100`.
  - **Tuy nhiên, do test suite chưa chạy thành công ở môi trường runtime, tính năng này hiện chỉ được kiểm chứng ở mức rà soát mã nguồn (static code review), chưa được xác nhận qua runtime test execution.**

---

## 5. Các Câu Hỏi Cần Alex (InfoSec Lead) Xác Nhận

Dưới đây là các câu hỏi phối hợp nghiệp vụ kỹ thuật đã được ghi nhận (chờ trao đổi chính thức, không tự ý giả định):

1. **Quy tắc làm tròn số nguyên `priorityScore`:**
   - Contract `AvaTriageRegistry.sol` yêu cầu `uint256 priorityScore` (số nguyên `0..100`).
   - Hiện tại [triage-scorer.js#L65](file:///C:/Users/Admin/avalanche-security-triage/backend/rules/triage-scorer.js#L65) đang trả về số thập phân 1 chữ số (`Math.round(raw * 10) / 10`).
   - *Câu hỏi:* Alex xác nhận áp dụng quy tắc làm tròn nguyên nào? Chuẩn làm tròn gần nhất `Math.round(raw)` (half-up) hay làm tròn xuống `Math.floor(raw)`?
2. **Quy tắc tổng hợp điểm cấp Report (Report-level Priority Score):**
   - Khi phân tích contract có nhiều findings (ví dụ 3 findings có điểm lần lượt là 95.0, 97.0, 11.5), `priorityScore` tổng của report được tính theo công thức nào?
   - Trong `docs/mock-data.json`, `compositeRiskScore` là 84.5 nhưng chưa có tài liệu hay mã nguồn nào mô tả công thức tính ra số này.
   - *Câu hỏi:* Khi có nhiều findings, report-level score là giá trị lớn nhất (max finding), trung bình có trọng số, hay công thức nào khác?
3. **Kế hoạch triển khai Registry lên Fuji:**
   - Khi nào Alex hoàn tất triển khai `AvaTriageRegistry.sol` lên Avalanche Fuji để cung cấp địa chỉ chính thức và tx hash xác minh?

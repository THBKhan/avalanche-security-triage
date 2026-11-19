# 📋 Tài Liệu Tích Hợp On-Chain Registry (AvaTriageRegistry)

> **Mục tiêu:** Đặc tả giao diện contract, chữ ký hàm, ràng buộc dữ liệu thực tế, và quy tắc tích hợp Web3 Attestation cho hệ thống Avalanche Security Triage trên Avalanche Fuji Testnet.  
> **Người phụ trách:** THBKhan (SE Lead) phối hợp với Alexvuong2006 (InfoSec Lead).  
> **Trạng thái:** Đã đối chiếu quy tắc điểm với review PR #2; chờ địa chỉ registry đã deploy trên Fuji.

---

## 1. Chữ Ký Hàm và Thứ Tự Tham Số

Hàm ghi nhận attestation được định nghĩa trong contract [AvaTriageRegistry.sol](../contracts/contracts/AvaTriageRegistry.sol#L47-L59) và ABI [AvaTriageRegistry.json](../contracts/abi/AvaTriageRegistry.json#L320-L352):

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

Dựa trên mã nguồn tại [AvaTriageRegistry.sol](../contracts/contracts/AvaTriageRegistry.sol#L60-L75):

| Tham số / Trạng thái | Ràng buộc trong code | Custom Error khi vi phạm | Bằng chứng mã nguồn |
| :--- | :--- | :--- | :--- |
| `targetContract` | Không được là `address(0)` | `error ZeroAddress()` | [AvaTriageRegistry.sol#L60-L62](../contracts/contracts/AvaTriageRegistry.sol#L60-L62) |
| `reportHash` | Không được là `bytes32(0)` | `error InvalidReportHash()` | [AvaTriageRegistry.sol#L63-L65](../contracts/contracts/AvaTriageRegistry.sol#L63-L65) |
| `priorityScore` | Phải là số nguyên `0 <= priorityScore <= 100` (`MAX_PRIORITY_SCORE = 100`) | `error InvalidPriorityScore(uint256 score)` | [AvaTriageRegistry.sol#L66-L68](../contracts/contracts/AvaTriageRegistry.sol#L66-L68) |
| `ipfsUri` | Chiều dài bytes không vượt quá `512` (`MAX_IPFS_URI_LENGTH = 512`). **Cho phép chuỗi rỗng `""`** (không có kiểm tra độ dài tối thiểu trong Solidity) | `error IpfsUriTooLong(uint256 length, uint256 maxLength)` | [AvaTriageRegistry.sol#L69-L72](../contracts/contracts/AvaTriageRegistry.sol#L69-L72) |
| Chống lặp (Idempotency) | Cùng một `msg.sender` (auditor) không được attest trùng lặp cùng một bộ `(targetContract, reportHash)` | `error DuplicateAttestation(address auditor, address targetContract, bytes32 reportHash)` | [AvaTriageRegistry.sol#L73-L75](../contracts/contracts/AvaTriageRegistry.sol#L73-L75) |

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
*(Bằng chứng: [AvaTriageRegistry.sol#L94-L102](../contracts/contracts/AvaTriageRegistry.sol#L94-L102))*

---

## 3. Trạng Thái Triển Khai Trên Avalanche Fuji

Theo tài liệu hiện có tại [DEPLOYED_ADDRESSES.md](../contracts/DEPLOYED_ADDRESSES.md#L14-L17):
- **Trạng thái:** `Pending deployment` (Chưa deploy lên Avalanche Fuji Testnet).
- **Địa chỉ Registry:** Chưa có địa chỉ hợp lệ được xác minh.
- **Fuji Chain ID:** `43113`.
- **Fuji RPC URL:** `https://api.avax-test.network/ext/bc/C/rpc`.
- **Explorer:** `https://testnet.snowtrace.io/` (Lưu ý: Đây là cấu hình tài liệu được ghi nhận trong repo, **chưa được coi là đã xác minh live** vì chưa có contract/tx thực tế).

### Quy tắc an toàn bắt buộc khi thiếu địa chỉ:
1. **Tuyệt đối không tạo địa chỉ giả làm fallback** trong cấu hình ứng dụng (`REGISTRY_ADDRESS` không được gán địa chỉ tùy tiện).
2. Khi `REGISTRY_ADDRESS` trống hoặc chưa được xác nhận, nút **“Attest on Avalanche Fuji”** trên Frontend **phải bị vô hiệu hóa hoàn toàn (disabled)** và hiển thị thông báo rõ ràng cho người dùng:
   > *"Nút Attest bị vô hiệu hóa: Contract Registry chưa được triển khai hoặc chưa được cấu hình địa chỉ hợp lệ trên Avalanche Fuji."*
3. Địa chỉ mock/giả định chỉ được phép xuất hiện trong test cô lập của hardhat hoặc chế độ mock frontend được gắn nhãn minh bạch.

---

## 4. Kiểm thử runtime

Alex báo **14/14 test Hardhat đạt** trong [review của Alex trên PR #2](https://github.com/THBKhan/avalanche-security-triage/pull/2#pullrequestreview-5954212459), gồm trường hợp `ipfsUri` rỗng và điểm biên 0, 100. Lần chạy trước đó trong workspace chưa có dependency Hardhat nên không chạy được bộ test. [Ca kiểm thử registry](../contracts/test/AvaTriageRegistry.test.ts#L48-L56).

## 5. Quy tắc điểm và triển khai

- Backend tính điểm có trọng số, gọi `Math.round(raw)` một lần để xuất số nguyên 0–100 và băm snapshot sau khi chốt điểm.
- Điểm báo cáo lấy max chỉ trong các finding được review là `potential-issue`, hoặc 0 nếu nhóm rỗng. Các candidate chưa review, `needs-review` và `dismissed` vẫn hiển thị với điểm riêng. Báo cáo thiếu finding đủ điều kiện sẽ không attest.
- Địa chỉ cung cấp trong phiên này không có bytecode trên Fuji ở block `61343231`. Chờ registry đã deploy và tx hash từ nhóm trước khi cấu hình `REGISTRY_ADDRESS`.

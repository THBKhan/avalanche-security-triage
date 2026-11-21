# Dữ liệu mẫu và provenance

- [mock-data.json](../mock-data.json) là payload `POST /api/analyze` minh họa, cùng cấu trúc với fixture `source-with-rpc-error-200.json`. Giá trị địa chỉ, finding, điểm và thời gian đều giả định. `assetImpact = 0` vì RPC không khả dụng; không dùng payload này để ghi attestation.
- [JSON Schema](../schema/analyze-response.schema.json) là hợp đồng cấu trúc. Validator kiểm tra kiểu và nhánh response, không chứng minh finding, hash, RPC hay tính đúng của mô hình điểm.
- [ASSET_IMPACT_MODEL.md](ASSET_IMPACT_MODEL.md) ghi thang phi tuyến dự kiến và điều kiện dữ liệu để có thể dùng về sau. Runtime hiện chưa dùng thang này.

Nguồn dữ liệu thật được API gắn vào `targetContract` khi RPC khả dụng, gồm `queriedAt`; khi không khả dụng, `status` và `warning` phản ánh thiếu dữ liệu. `report.limitations`, `finding.liveContext.note` và `scores.assetImpact` giúp người xem hiểu điểm thay thế. Không gán `fundsAtRisk` từ số dư ví hoặc contract nếu chưa chứng minh đường chịu tác động.

# Dữ liệu mẫu và provenance

- [mock-data.json](../mock-data.json) là payload `POST /api/analyze` minh họa, cùng cấu trúc với fixture `source-with-rpc-error-200.json`. Giá trị địa chỉ, finding, điểm và thời gian đều giả định. `assetImpact = 0` vì RPC không khả dụng; không dùng payload này để ghi attestation.
- [JSON Schema](../schema/analyze-response.schema.json) là hợp đồng cấu trúc. Validator kiểm tra kiểu và nhánh response, không chứng minh finding, hash, RPC hay tính đúng của mô hình điểm.
- [ASSET_IMPACT_MODEL.md](ASSET_IMPACT_MODEL.md) ghi thang phi tuyến dự kiến và điều kiện dữ liệu để có thể dùng về sau. Runtime hiện chưa dùng thang này.

`targetContract.dataSource` ghi `fuji-rpc` khi đã thử đọc Fuji, `none` cho source-only. `queriedAt` chỉ có khi dữ liệu cốt lõi đọc thành công; `attemptedAt` ghi lúc bắt đầu lần đọc bị lỗi. `status` và `warning` phản ánh thiếu dữ liệu. `report.scoreExplanation`, `limitations`, `finding.liveContext.note` và `scores.assetImpact` giải thích điểm thay thế. Không gán `fundsAtRisk` từ số dư ví hoặc contract nếu chưa chứng minh đường chịu tác động.

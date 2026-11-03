# Thương hiệu

Mọi tên và logo của sản phẩm đều sinh ra từ thư mục này.

## Đổi tên hoặc logo

1. Sửa `brand.json`.
2. Thay `logo.svg`. Logo phải là hình vector một màu, gồm các thẻ `<path>`, có `viewBox`.
3. Chạy `pnpm run brand:apply`, rồi `pnpm run build`.

Tên sản phẩm không được chứa "DeepSeek Harness" vì đây là nhãn hiệu của DeepSeek.

## Các trường trong `brand.json`

| Trường | Ý nghĩa |
|---|---|
| `productName` | Tên đầy đủ hiển thị trên giao diện và trình cài đặt |
| `shortName` | Tên ngắn cho biểu tượng trên màn hình chính |
| `publisher` | Tên công ty phát hành app Desktop |
| `appId` | Mã app Desktop, dạng tên miền đảo ngược. Đổi sau khi đã phát hành thì máy người dùng coi là app khác |
| `artifactName` | Tiền tố tên file cài đặt, chữ thường và dấu gạch ngang |
| `accentColor` | Màu logo trên icon và trình cài đặt |

## Cập nhật từ DeepSeek

```sh
git fetch upstream
git merge upstream/master
pnpm run brand:apply
```

Script ghi đè lại các chuỗi và tài sản thương hiệu, nên chạy lại sau mỗi lần merge. Khi có xung đột ở các file do script sinh ra, cứ lấy bản của upstream rồi chạy lại script.

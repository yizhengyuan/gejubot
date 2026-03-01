# KataGo 商用合规清单（GejuBot）

> 适用范围：基于 KataGo 引擎与 katagotraining 网络权重的商用发布场景。  
> 说明：本文是工程合规清单，不构成法律意见。

---

## 1. 最低必须项（Must Have）

- [ ] 保留 `KataGo` 引擎许可证（MIT）
- [ ] 保留 `KataGo` 网络权重许可证（Neural Net License，MIT 风格）
- [ ] 在产品 `About/Legal` 页面显示归属与许可证入口
- [ ] 若分发安装包/可执行文件，附带第三方依赖许可证文本
- [ ] 若修改过源码并对外分发，保留原版权声明并标注修改

---

## 2. 建议在本仓库放置的文件

建议在 `gejubot` 下新增：

- `LICENSES/KataGo-LICENSE.txt`
- `LICENSES/KataGo-Network-License.txt`
- `THIRD_PARTY_NOTICES.md`

建议在 `README.md` 或前端页脚中增加：

- `Legal / Licenses` 入口
- 指向上述文件的链接

---

## 3. 发布前检查（Release Gate）

### A. 引擎与网络来源确认

- [ ] `KATAGO_BINARY` 来源于官方发布包
- [ ] `KATAGO_MODEL` 来源于官方网络页面
- [ ] 记录版本号（示例：`KataGo v1.16.4`、`kata1-b28...`）

### B. 许可证文件齐全

- [ ] 引擎 MIT 许可证文本已入库
- [ ] 网络许可证文本已入库
- [ ] 第三方依赖许可证已汇总（如使用分发包）

### C. 产品内可见声明

- [ ] UI 有 `About/Legal` 入口
- [ ] 显示 “Powered by KataGo”
- [ ] 提供许可证文本访问路径

### D. 修改与再分发

- [ ] 若改过源码，变更说明里写清修改内容
- [ ] 保留上游版权与许可证头部

---

## 4. 可直接使用的声明模板

## 4.1 About 页面简版

```text
This product uses KataGo (https://github.com/lightvector/KataGo),
licensed under the MIT License.

Neural network weights are from KataGo distributed training
(https://katagotraining.org/) under the network license terms.

See Legal / Licenses for full license texts and third-party notices.
```

## 4.2 THIRD_PARTY_NOTICES 示例

```text
KataGo
Copyright (c) David J. Wu
License: MIT
Source: https://github.com/lightvector/KataGo

KataGo Neural Network Weights
Source: https://katagotraining.org/
License: https://katagotraining.org/network_license/
```

---

## 5. 你当前 GejuBot 项目的落地建议

- 在仓库新增 `LICENSES/` 并放入两份许可文本
- 新增 `THIRD_PARTY_NOTICES.md`
- 在 `README.md` 增加 `Legal` 小节，注明 KataGo 与网络来源
- 后续如果做公网部署，在网页右下角加 `Legal` 链接

---

## 6. 官方参考链接

- KataGo 仓库：<https://github.com/lightvector/KataGo>
- KataGo LICENSE：<https://raw.githubusercontent.com/lightvector/KataGo/master/LICENSE>
- katagotraining 网络许可证：<https://katagotraining.org/network_license/>
- katagotraining 首页：<https://katagotraining.org/>


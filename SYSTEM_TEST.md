# COMP5568 系统测试指南

> 本文档逐步验证所有基础功能和 Bonus 功能。每个测试用例包含：前置条件、操作步骤、预期结果（含具体数值）。

---

## 环境启动

### Step 0 — 启动服务

**终端 1**（保持运行）：
```bash
npm run node
```
等待输出：`Started HTTP and WebSocket JSON-RPC server at http://127.0.0.1:8545/`

**终端 2**（部署合约）：
```bash
npm run deploy
```
预期输出末尾：
```
Deployment complete!
  C5D:          0x5FbDB2315678afecb367f032d93F642f64180aa3
  WETH:         0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
  LendingPool:  0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
  GovToken:     0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
```

**终端 3**（前端）：
```bash
npm run frontend
```
访问 http://localhost:3000

**MetaMask**：
- 网络：Localhost 8545，Chain ID 1337，RPC http://127.0.0.1:8545
- 导入账户：私钥 `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`（Account #0，10000 ETH）
- 右上角点 **Connect Wallet**

部署后账户初始余额：
- C5D：100,000
- WETH：50
- ETH：~10,000（少量被 deploy 消耗）

---

## 基础功能测试

---

### TC-01 Dashboard 初始状态

**前置条件**：刚完成部署，未做任何存款/借款操作  
**页面**：`/`（Dashboard）

**预期结果**：

| 字段 | 预期值 |
|------|--------|
| Total Collateral | $0.00 |
| Total Debt | $0.00 |
| Health Factor | ∞（或 "No debt"） |
| C5D Market TVL | $0.00 |
| WETH Market TVL | $0.00 |
| C5D Supply APY | 0.00%（利用率为 0） |
| WETH Supply APY | 0.00% |

---

### TC-02 存款 — Deposit C5D

**页面**：`/supply`  
**操作**：
1. 在 C5D 一栏输入 `5000`，点击 **Supply**
2. MetaMask 弹出 → 确认 approve → 确认 deposit

**预期结果**：

| 字段 | 预期值 |
|------|--------|
| C5D Supply Balance | ≈ 5,000 C5D |
| Dashboard — Total Collateral | ≈ $5,000（C5D 价格 $1） |
| Dashboard — Health Factor | ∞（无借款） |
| C5D Market TVL | ≈ $5,000 |
| 钱包 C5D 余额 | 95,000 C5D（减少 5,000） |

---

### TC-03 存款 — Deposit WETH

**页面**：`/supply`  
**操作**：在 WETH 一栏输入 `1`，点击 **Supply** → 确认两次 MetaMask

**预期结果**：

| 字段 | 预期值 |
|------|--------|
| WETH Supply Balance | ≈ 1 WETH |
| Dashboard — Total Collateral | ≈ $7,000（5000 C5D + 2000 WETH） |
| WETH Market TVL | ≈ $2,000 |

---

### TC-04 借款 — Borrow C5D

**前置条件**：已存入 1 WETH（价值 $2,000）  
**页面**：`/borrow`  
**操作**：在 C5D 一栏输入 `1000`，点击 **Borrow** → 确认 MetaMask

**预期结果**：

| 字段 | 预期值 | 计算依据 |
|------|--------|---------|
| C5D Borrow Balance | ≈ 1,000 C5D | — |
| Health Factor | ≈ 1.60 | (2000×80% + 5000×85%) / 1000 = 5850/1000 = 5.85... |

> 注意：如果 TC-02 的 5000 C5D 也计入抵押，HF 会更高。若只用 1 WETH 作抵押（重新测试时先不存 C5D），则：
> HF = 2000 × 80% / 1000 = **1.60**

---

### TC-05 Health Factor — 近临界测试

**操作**：在 TC-04 基础上，继续借款至接近上限  
在 `/borrow` 页面查看 **Max Borrow** 提示值，借入接近最大值（例如 Max 显示 1500，输入 1490）

**预期结果**：

| 字段 | 预期值 |
|------|--------|
| Health Factor | 1.0 ~ 1.10（黄色警告） |
| 超过 Max 时点击 Borrow | 报错："Insufficient collateral" |

---

### TC-06 还款 — Repay

**前置条件**：有借款余额  
**页面**：`/borrow`  
**操作**：在 C5D 还款栏输入 `500`，点击 **Repay** → 确认 MetaMask

**预期结果**：

| 字段 | 预期值 |
|------|--------|
| C5D Borrow Balance | 减少约 500 C5D |
| Health Factor | 升高（具体值取决于当前仓位） |

**操作**：点击 **Repay MAX**（全额还款）

**预期结果**：
- Borrow Balance → 0（或 ≤ 1 wei，index 舍入导致，属正常现象）
- Health Factor → ∞

---

### TC-07 取款 — Withdraw

**前置条件**：无借款（或已还清）  
**页面**：`/supply`  
**操作**：在 WETH 取款栏输入 `1`，点击 **Withdraw** → 确认 MetaMask

**预期结果**：

| 字段 | 预期值 |
|------|--------|
| WETH Supply Balance | 减少 1 WETH |
| Total Collateral | 减少 $2,000 |

**边界测试**：有借款时尝试取走全部抵押品  
**预期**：报错 "Withdrawal would undercollateralize position"

---

### TC-08 利率模型 — 利用率影响 APY

**操作**：
1. `/supply` 页面：存入 1,000 C5D
2. `/borrow` 页面：借出 500 C5D（利用率 = 50%）
3. 回到 Dashboard 查看 APY

**预期结果**（C5D 参数：baseRate=2%, slope=10%）：

| 指标 | 计算 | 预期值 |
|------|------|--------|
| 利用率 | 500/1000 | 50% |
| Borrow APY | 2% + 10%×0.5 | **7.00%** |
| Supply APY | 7% × 50% × 90% | **3.15%** |

---

## Bonus 功能测试

---

### TC-09 清算机制（Liquidation）

#### 9-A 创建可清算仓位

> 需要用管理员脚本临时降低 WETH 价格。在终端 2 运行：

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 npx hardhat console --network localhost --config hardhat.config.cjs
```

在 console 里执行：
```javascript
const pool = await ethers.getContractAt("LendingPool", "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0")
const weth = await ethers.getContractAt("MockWETH", "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512")
const c5d  = await ethers.getContractAt("Stablecoin", "0x5FbDB2315678afecb367f032d93F642f64180aa3")
const [owner, alice] = await ethers.getSigners()

// ── 初始化（重复测试时清理上一次遗留状态）────────────────────────
// 1. 重置 WETH 价格为 $2000（防止上次已降价）
await pool.setTokenPrice(await weth.getAddress(), ethers.parseEther("2000"))

// 2. 清除 Alice 的遗留借款（如有）
const aliceBorrow = await pool.getBorrowBalance(alice.address, await c5d.getAddress())
if (aliceBorrow > 0n) {
  await c5d.mint(alice.address, aliceBorrow + ethers.parseEther("10"))
  await c5d.connect(alice).approve(await pool.getAddress(), ethers.MaxUint256)
  await pool.connect(alice).repay(await c5d.getAddress(), ethers.MaxUint256)
}

// 3. 清除 Alice 的遗留存款（如有）
const aliceSupply = await pool.getSupplyBalance(alice.address, await weth.getAddress())
if (aliceSupply > 0n) {
  await pool.connect(alice).withdraw(await weth.getAddress(), ethers.MaxUint256)
}

// ── 建立可清算仓位 ───────────────────────────────────────────────
// Alice 存 1 WETH，借 1400 C5D（HF = 2000×80%/1400 = 1.14，健康）
await weth.mint(alice.address, ethers.parseEther("1"))
await weth.connect(alice).approve(await pool.getAddress(), ethers.MaxUint256)
await c5d.mint(alice.address, ethers.parseEther("5000"))
await c5d.connect(alice).approve(await pool.getAddress(), ethers.MaxUint256)
await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("1"))
await c5d.mint(owner.address, ethers.parseEther("100000"))  // 给 pool 提供流动性
await c5d.connect(owner).approve(await pool.getAddress(), ethers.MaxUint256)
await pool.deposit(await c5d.getAddress(), ethers.parseEther("50000"))
await pool.connect(alice).borrow(await c5d.getAddress(), ethers.parseEther("1400"))

// 降低 WETH 价格至 $1700（HF = 1700×80%/1400 = 0.971 < 1）
await pool.setTokenPrice(await weth.getAddress(), ethers.parseEther("1700"))
console.log("Alice HF:", ethers.formatEther(await pool.getHealthFactor(alice.address)))
// 预期输出：0.971...
```

#### 9-B 前端验证清算

**页面**：`/liquidate`  
**预期结果**：
- Alice 的地址出现在可清算列表
- HF 显示 **< 1.0**（红色）
- 显示可偿还的债务量（最多 700 C5D，即 50% close factor）

**操作**：
1. 选择 Alice 地址，债务 Token 选 C5D，抵押 Token 选 WETH
2. 输入 `700`（50% MAX）
3. 点击 **Liquidate** → 确认 MetaMask

**预期结果**：

| 字段 | 预期值 | 计算依据 |
|------|--------|---------|
| 偿还债务 | 700 C5D | 50% × 1400 |
| 获得抵押品 | ≈ 0.43 WETH | 700 × $1 × 1.05 / $1700 |
| 清算后 Alice HF | ≈ 1.10 | (0.57 WETH × $1700 × 80%) / 700 |
| 页面刷新后 Alice 消失 | 从可清算列表移除 | HF 恢复健康 |

---

### TC-10 闪电贷（Flash Loan）

Flash Loan 页面是信息展示页（前端不执行实际闪电贷，合约逻辑已通过 20 个单元测试验证）。

**页面**：`/flash-loan`  
**验证内容**：

| 元素 | 预期值 |
|------|--------|
| Fee Rate | **9 bps (0.09%)** |
| C5D Available Liquidity | 等于池中 C5D 余额（TC-09 存了 50,000 → 扣除借出的显示约 48,600） |
| Fee Simulator：输入 10000 | Fee = 10000 × 0.0009 = **9 C5D** |
| 代码示例 | 显示 IFlashLoanReceiver 接口和示例合约 |

---

## 边界与异常测试

### TC-11 输入校验

| 操作 | 预期报错 |
|------|---------|
| 存款金额 = 0 | "Amount must be > 0" |
| 借款超过 Max | "Insufficient collateral" |
| 还款无借款 | "No debt to repay" |
| 清算 HF ≥ 1 的账户 | "Position is healthy" |
| 清算自己 | "Cannot liquidate yourself" |
| 非 owner 调用 setTokenPrice | MetaMask 报错 / revert |

### TC-12 Interest Accrual 验证

**操作**：
1. 记录存款余额（例如 1,000 C5D）
2. 在 Borrow 页面制造 50% 利用率
3. 点击 Dashboard 的 **Accrue Interest** 按钮（或等待若干区块）
4. 回到 Supply 页面查看余额

**预期结果**：
- Supply Balance 轻微增加（> 1,000 C5D）
- 具体增量：约 1000 × 3.15% / 2,102,400 × blockDelta

---

## 测试完成验收清单

| 功能 | 测试用例 | 通过标准 |
|------|---------|---------|
| Dashboard 展示 | TC-01 | 所有字段正确显示 |
| MetaMask 集成 | 全部 TC | 交易可确认，无报错 |
| Deposit / Withdraw | TC-02、03、07 | 余额正确变化 |
| Borrow / Repay | TC-04、06 | 余额和 HF 正确变化 |
| Health Factor | TC-05 | 数值与计算一致 |
| 利率模型 | TC-08 | APY 与公式吻合 |
| Liquidation | TC-09 | 正确执行并获奖励 |
| Flash Loan | TC-10 | 信息展示正确 |
| 边界校验 | TC-11 | 错误操作被拒绝 |
| 利息累积 | TC-12 | 余额随区块增加 |

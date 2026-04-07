# COMP5568 期末项目要求

> 来源：课程 Final Project 说明文档

---

## 基本信息

- **形式**：小组完成，每组 4-6 人
- **题目**：去中心化借贷协议（Decentralized Lending & Borrowing Protocol）
- **区块链平台**：以太坊（私链或测试网），或其他自选平台

---

## 基础功能（必须实现）

### 1. Web3 钱包集成
- 集成 Web3 钱包，例如 MetaMask

### 2. 借贷池机制（Lending Pool Mechanics）
- 支持至少两种 ERC-20 代币（例如：稳定币 USDC + 波动性资产 ETH/WBTC）
- 用户必须能执行 4 个核心操作：
  - **存款（Deposit / Supply）**
  - **取款（Withdraw）**
  - **借款（Borrow）**
  - **还款（Repay）**

### 3. 风险管理（Risk Management）
- 实现**超额抵押**逻辑
- 实时计算并显示**健康因子（Health Factor, HF）**
- 执行**贷款价值比（LTV）**限制

### 4. 利率模型（Interest Rate Model）
- 实现基于**利用率（Utilization Rate）**的动态利率模型
  - 可使用简单线性模型，或"Kinked"模型（详见 Lec5）
- 按**区块（per block）**为存款人和借款人累计利息

### 5. 仪表盘（Dashboard）
- 显示用户当前仓位信息：
  - 总抵押（Total Collateral）
  - 总债务（Total Debt）
  - 当前年化利率 APY（存款/借款）
  - 健康因子（Health Factor）
  - 其他相关数据

---

## 附加功能（Bonus，选做）

### 清算机制（Liquidation Mechanism）
- 实现当健康因子 < 1 时，允许第三方清算该仓位的功能
- 实现清算奖励/清算溢价（Liquidation Spread / Bonus），激励清算人

### 闪电贷（Flash Loan）
- 实现与借贷池兼容的闪电贷接口

### 预言机集成（Oracle Integration）
- 不硬编码价格，而是集成真实价格预言机（例如：Chainlink 测试网）获取资产价格

### 高级代币经济（Advanced Tokenomics）
- 发行治理代币（类似 COMP 或 AAVE）
- 作为流动性挖矿奖励，激励存款人和借款人

### 数据分析与用户体验（Analytics & UX）
- APY 变化或利用率的历史图表
- 其他友好的用户体验功能

---

## 其他创新想法（获得更高分数）

- 用 **NFT 作为抵押品**
- 设计**非传统的利率模型**（甚至反直觉的模型）
- 其他有创意的设计

---

## 评分标准

| 部分 | 权重 |
|------|------|
| 演示 + 口头答辩 | 70% |
| 报告 + 代码 + Git 提交记录 | 30% |

**重要说明：**
- 口头答辩和 Git 提交记录用于防止 LLM 滥用
- 更具个性化和创新性的方案将获得更高分数
- 必须提交《荣誉声明（Honour Declaration for Group Assessment/Assignment）》
- 零容忍违反声明的行为，违规将导致**整组期末项目得零分**

---

## 本项目对应情况

| 要求 | 完成情况 |
|------|---------|
| MetaMask 集成 | ✅ |
| 两种 ERC-20 代币（C5D + WETH） | ✅ |
| Deposit / Withdraw / Borrow / Repay | ✅ |
| 超额抵押逻辑 | ✅ |
| 健康因子实时显示 | ✅ |
| LTV 限制 | ✅ |
| 动态利率模型（线性，基于利用率） | ✅ |
| 按区块累计利息 | ✅ |
| Dashboard 仪表盘 | ✅ |
| 清算机制（Bonus） | 🔲 待开发 |
| 闪电贷（Bonus） | 🔲 待开发 |
| Chainlink 预言机（Bonus） | 🔲 待开发 |
| 治理代币（Bonus） | 🔲 待开发 |
| NFT 作为抵押品（创新加分） | 🔲 待开发 |

# COMP5521 NFT 市场前端

这是一个基于 React + Vite + ethers.js 的 NFT 市场前端应用。

## 功能特性

- 🔗 钱包连接（MetaMask）
- 🖼️ NFT 市场浏览
- 💰 使用稳定币（C5D）购买 NFT
- 📦 查看和管理自己的 NFT
- 🛒 NFT 上架和取消上架

## 开始使用

### 1. 安装依赖

```bash
cd frontend
npm install
```

### 2. 配置合约地址

创建 `.env` 文件（或修改 `.env.local`）：



### 3. 启动开发服务器

```bash
npm run dev
```

应用将在 `http://localhost:3000` 启动。

## 项目结构

```
frontend/
├── src/
│   ├── components/          # React 组件
│   │   ├── WalletConnect.jsx    # 钱包连接组件
│   │   ├── Marketplace.jsx      # 市场页面
│   │   └── MyNFTs.jsx           # 我的 NFT 页面
│   ├── hooks/              # 自定义 Hooks
│   │   └── useWeb3.js          # Web3 连接 Hook
│   ├── config/             # 配置文件
│   │   ├── contracts.js        # 合约地址配置
│   │   └── abis.js             # 合约 ABI
│   ├── App.jsx             # 主应用组件
│   ├── App.css             # 样式文件
│   └── main.jsx            # 入口文件
├── package.json
├── vite.config.js
└── tailwind.config.js
```

## 使用说明

1. **连接钱包**：点击右上角的"连接钱包"按钮，使用 MetaMask 连接
2. **浏览市场**：在首页查看所有在售的 NFT
3. **购买 NFT**：点击"购买"按钮，确认交易即可
4. **查看我的 NFT**：点击导航栏的"我的 NFT"查看您拥有的 NFT
5. **上架 NFT**：在"我的 NFT"页面，点击"上架出售"按钮，输入价格即可上架

## 注意事项

- 确保已安装 MetaMask 或其他 Web3 钱包
- 确保钱包连接到正确的网络（本地开发网络或测试网络）
- 购买 NFT 前需要先批准市场合约使用您的稳定币
- 上架 NFT 前需要先批准市场合约转移您的 NFT

## 技术栈

- **React 18** - UI 框架
- **Vite** - 构建工具
- **ethers.js v6** - 以太坊交互库
- **Tailwind CSS** - 样式框架
- **React Router** - 路由管理
- **lucide-react** - 图标库

## 开发建议

1. 在实际部署前，建议添加错误处理和加载状态优化
2. 考虑使用事件监听来实时更新市场列表，而不是轮询
3. 可以添加 NFT 元数据缓存机制以提高性能
4. 建议添加交易历史记录功能


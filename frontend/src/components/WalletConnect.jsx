import { useWeb3 } from '../hooks/useWeb3';
import { Wallet } from 'lucide-react';

export default function WalletConnect() {
  const { account, isConnected, isLoading, connectWallet, disconnectWallet } = useWeb3();

  const formatAddress = (address) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  if (isConnected && account) {
    return (
      <div className="flex items-center gap-3">
        <div className="px-4 py-2 bg-green-100 text-green-800 rounded-lg font-medium">
          {formatAddress(account)}
        </div>
        <button
          onClick={disconnectWallet}
          className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
        >
          断开连接
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connectWallet}
      disabled={isLoading}
      className="flex items-center gap-2 px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Wallet size={20} />
      {isLoading ? '连接中...' : '连接钱包'}
    </button>
  );
}


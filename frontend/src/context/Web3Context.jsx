import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ethers } from 'ethers';

const Web3Context = createContext(null);

export function Web3Provider({ children }) {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const initializeProvider = useCallback(async () => {
    const web3Provider = new ethers.BrowserProvider(window.ethereum);
    const web3Signer = await web3Provider.getSigner();
    setProvider(web3Provider);
    setSigner(web3Signer);
    return { web3Provider, web3Signer };
  }, []);

  const disconnectWallet = useCallback(() => {
    setProvider(null);
    setSigner(null);
    setAccount(null);
    setIsConnected(false);
  }, []);

  const connectWallet = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (!window.ethereum) {
        throw new Error('请安装 MetaMask 或其他 Web3 钱包');
      }

      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      await initializeProvider();

      setAccount(accounts[0]);
      setIsConnected(true);
    } catch (err) {
      setError(err.message);
      console.error('连接钱包失败:', err);
    } finally {
      setIsLoading(false);
    }
  }, [initializeProvider]);

  const handleAccountsChanged = useCallback(
    async (accounts) => {
      if (accounts.length === 0) {
        disconnectWallet();
        return;
      }

      try {
        await initializeProvider();
        setAccount(accounts[0]);
        setIsConnected(true);
      } catch (err) {
        console.error('更新账户失败:', err);
        setError(err.message);
      }
    },
    [disconnectWallet, initializeProvider]
  );

  const handleChainChanged = useCallback(() => {
    window.location.reload();
  }, []);

  const checkConnection = useCallback(async () => {
    if (!window.ethereum) return;

    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts.length > 0) {
        await initializeProvider();
        setAccount(accounts[0]);
        setIsConnected(true);
      }
    } catch (err) {
      console.error('检查连接状态失败:', err);
    }
  }, [initializeProvider]);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  useEffect(() => {
    if (!window.ethereum) return;

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, [handleAccountsChanged, handleChainChanged]);

  const value = {
    provider,
    signer,
    account,
    isConnected,
    isLoading,
    error,
    connectWallet,
    disconnectWallet,
  };

  return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>;
}

export function useWeb3Context() {
  const context = useContext(Web3Context);
  if (!context) {
    throw new Error('useWeb3 必须在 Web3Provider 中使用');
  }
  return context;
}


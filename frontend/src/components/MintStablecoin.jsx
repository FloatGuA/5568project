import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../hooks/useWeb3';
import { STABLECOIN_ABI } from '../config/abis';
import { CONTRACT_ADDRESSES } from '../config/contracts';

export default function MintStablecoin() {
  const { signer, account, isConnected } = useWeb3();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [decimals, setDecimals] = useState(18);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [contractOwner, setContractOwner] = useState('');

  useEffect(() => {
    async function checkOwnerAndDecimals() {
      if (!signer || !isConnected || !account) {
        setIsOwner(false);
        setContractOwner('');
        return;
      }
      try {
        const stablecoinContract = new ethers.Contract(CONTRACT_ADDRESSES.Stablecoin, STABLECOIN_ABI, signer);
        const owner = await stablecoinContract.owner();
        setContractOwner(owner);
        const isOwnerMatch = owner.toLowerCase() === account.toLowerCase();
        setIsOwner(isOwnerMatch);
        const dec = await stablecoinContract.decimals();
        setDecimals(Number(dec));
        console.log('Stablecoin owner check:', { owner, account, match: isOwnerMatch });
      } catch (err) {
        console.error('Stablecoin owner check error:', err);
        setIsOwner(false);
        setContractOwner('');
        setDecimals(18);
      }
    }
    checkOwnerAndDecimals();
  }, [signer, account, isConnected]);

  const handleMint = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const stablecoinContract = new ethers.Contract(CONTRACT_ADDRESSES.Stablecoin, STABLECOIN_ABI, signer);
      const tx = await stablecoinContract.mint(to, ethers.parseUnits(amount, decimals));
      await tx.wait();
      setMessage('稳定币发行成功！');
      setTo('');
      setAmount('');
    } catch (err) {
      setMessage('发行失败: ' + (err?.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return <div className="p-4">请先连接钱包</div>;
  }

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded shadow space-y-4">
      <h2 className="text-xl font-bold">发行稳定币</h2>
      
      {/* 调试面板 */}
      <div className="p-3 bg-gray-100 rounded text-sm space-y-1 border border-gray-300">
        <div><strong>当前账户:</strong> {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : '—'}</div>
        <div><strong>合约 Owner:</strong> {contractOwner ? `${contractOwner.slice(0, 6)}...${contractOwner.slice(-4)}` : '—'}</div>
        <div><strong>是否匹配:</strong> {isOwner ? '✓ 是' : '✗ 否'}</div>
        <div><strong>稳定币地址:</strong> <span className="font-mono text-xs">{CONTRACT_ADDRESSES.Stablecoin}</span></div>
      </div>

      {!isOwner && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          只有合约 owner 可以发行稳定币。请使用 owner 账户连接钱包。
        </div>
      )}

      {isOwner && (
        <form onSubmit={handleMint} className="space-y-4">
          <div>
            <label className="block mb-1 font-medium">接收地址</label>
            <input type="text" value={to} onChange={e => setTo(e.target.value)} required className="w-full border rounded px-2 py-1" placeholder="0x..." />
          </div>
          <div>
            <label className="block mb-1 font-medium">发行数量</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} required min="0" step="any" className="w-full border rounded px-2 py-1" placeholder="如 1000" />
          </div>
          <button type="submit" disabled={loading} className="w-full py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
            {loading ? '发行中...' : '发行稳定币'}
          </button>
        </form>
      )}

      {message && <div className="mt-3 text-center text-green-600">{message}</div>}
    </div>
  );
}

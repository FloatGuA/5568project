import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../hooks/useWeb3';
import { NFT_ABI } from '../config/abis';
import { CONTRACT_ADDRESSES } from '../config/contracts';

// NFT 元数据
const NFT_METADATA = {
  name: "COMP5521 Project NFT 0",
  description: "Official NFT for COMP5521 Final Project - Decentralized Marketplace",
  image: "https://www.nttdata.com.cn/-/media/nttdataapac/nttdatachina/images/digital/pic_digital_blockchain_01.jpg?h=1138&la=zh-CN&w=1621&hash=6D05AABCAE23B00B97C289941F7FF56D27515779",
  attributes: [
    {
      trait_type: "Course",
      value: "COMP5521"
    },
    {
      trait_type: "Category",
      value: "Blockchain Marketplace"
    },
    {
      trait_type: "Version",
      value: "1.0"
    }
  ]
};

// 将元数据编码为 data URI
const encodeMetadataToDataURI = () => {
  const jsonString = JSON.stringify(NFT_METADATA);
  const encodedJson = btoa(jsonString);
  return `data:application/json;base64,${encodedJson}`;
};

export default function MintNFT() {
  const { signer, account, isConnected } = useWeb3();
  const [to, setTo] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [contractOwner, setContractOwner] = useState('');

  useEffect(() => {
    async function checkOwner() {
      if (!signer || !isConnected || !account) {
        setIsOwner(false);
        setContractOwner('');
        return;
      }
      try {
        const nftContract = new ethers.Contract(CONTRACT_ADDRESSES.NFT, NFT_ABI, signer);
        const owner = await nftContract.owner();
        setContractOwner(owner);
        const isOwnerMatch = owner.toLowerCase() === account.toLowerCase();
        setIsOwner(isOwnerMatch);
        console.log('Owner check:', { owner, account, match: isOwnerMatch });
      } catch (err) {
        console.error('Owner check error:', err);
        setIsOwner(false);
        setContractOwner('');
      }
    }
    checkOwner();
  }, [signer, account, isConnected]);

  const handleMint = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const nftContract = new ethers.Contract(CONTRACT_ADDRESSES.NFT, NFT_ABI, signer);
      const tokenURI = encodeMetadataToDataURI();
      const tx = await nftContract.safeMint(to, tokenURI);
      await tx.wait();
      setMessage('NFT 发行成功！');
      setTo('');
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
      <h2 className="text-xl font-bold">发行 NFT</h2>
      
      {/* 调试面板 */}
      <div className="p-3 bg-gray-100 rounded text-sm space-y-1 border border-gray-300">
        <div><strong>当前账户:</strong> {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : '—'}</div>
        <div><strong>合约 Owner:</strong> {contractOwner ? `${contractOwner.slice(0, 6)}...${contractOwner.slice(-4)}` : '—'}</div>
        <div><strong>是否匹配:</strong> {isOwner ? '✓ 是' : '✗ 否'}</div>
        <div><strong>NFT 地址:</strong> <span className="font-mono text-xs">{CONTRACT_ADDRESSES.NFT}</span></div>
      </div>

      {!isOwner && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          只有合约 owner 可以发行 NFT。请使用 owner 账户连接钱包。
        </div>
      )}

      {isOwner && (
        <form onSubmit={handleMint} className="space-y-4">
          <div>
            <label className="block mb-1 font-medium">接收地址</label>
            <input type="text" value={to} onChange={e => setTo(e.target.value)} required className="w-full border rounded px-2 py-1" placeholder="0x..." />
          </div>
          <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm">
            <div className="font-medium text-blue-900 mb-2">NFT 元数据（固定）</div>
            <div className="text-blue-800 space-y-1">
              <div><strong>名称:</strong> {NFT_METADATA.name}</div>
              <div><strong>描述:</strong> {NFT_METADATA.description}</div>
              <div><strong>图片:</strong> <a href={NFT_METADATA.image} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">查看</a></div>
            </div>
          </div>
          <button type="submit" disabled={loading} className="w-full py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {loading ? '发行中...' : '发行 NFT'}
          </button>
        </form>
      )}

      {message && <div className="mt-3 text-center text-green-600">{message}</div>}
    </div>
  );
}

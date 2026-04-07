import { useState, useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import { Upload, X } from 'lucide-react';
import { useWeb3 } from '../hooks/useWeb3';
import { CONTRACT_ADDRESSES } from '../config/contracts';
import { NFT_ABI, MARKETPLACE_ABI } from '../config/abis';

const NFT_QUERY_START_BLOCK = Number(import.meta.env.VITE_NFT_START_BLOCK ?? 0);
const DEFAULT_GATEWAY = import.meta.env.VITE_IPFS_GATEWAY ?? 'https://ipfs.io/ipfs/';

const initialModalState = { visible: false, tokenId: null };

const normalizeUri = (uri) => {
  if (!uri) return '';
  if (uri.startsWith('ipfs://')) {
    return `${DEFAULT_GATEWAY}${uri.replace('ipfs://', '')}`;
  }
  return uri;
};

const decodeDataUriImage = (uri) => {
  if (!uri.startsWith('data:application/json')) return { image: uri, raw: uri };
  try {
    const [, base64Payload] = uri.split(',');
    const json = JSON.parse(atob(base64Payload));
    return {
      image: json.image ? normalizeUri(json.image) : '',
      raw: uri,
      name: json.name,
      description: json.description,
    };
  } catch {
    return { image: '', raw: uri };
  }
};

const fetchMetadataFromUri = async (uri) => {
  const normalized = normalizeUri(uri);
  if (!normalized) {
    return { tokenURI: '', image: '', name: '', description: '' };
  }

  if (normalized.startsWith('data:')) {
    return { ...decodeDataUriImage(normalized), tokenURI: normalized };
  }

  if (normalized.endsWith('.json') || normalized.includes('.json?')) {
    try {
      const resp = await fetch(normalized);
      if (!resp.ok) throw new Error('metadata fetch failed');
      const meta = await resp.json();
      return {
        tokenURI: normalized,
        image: meta.image ? normalizeUri(meta.image) : '',
        name: meta.name,
        description: meta.description,
      };
    } catch (err) {
      console.warn('获取 metadata 失败', normalized, err);
      return { tokenURI: normalized, image: '', name: '', description: '' };
    }
  }

  return { tokenURI: normalized, image: normalized, name: '', description: '' };
};

const determineOwnedTokenIds = (events, target) => {
  const owner = target.toLowerCase();
  const ownership = new Map();

  for (const event of events) {
    const { from, to, tokenId } = event.args ?? {};
    if (!tokenId) continue;
    const id = tokenId.toString();
    if (to?.toLowerCase() === owner) {
      ownership.set(id, true);
    }
    if (from?.toLowerCase() === owner) {
      ownership.delete(id);
    }
  }

  return [...ownership.keys()];
};

export default function MyNFTs() {
  const { signer, provider, account, isConnected } = useWeb3();
  const readProvider = signer ?? provider;
  const [nfts, setNfts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [listModal, setListModal] = useState(initialModalState);
  const [priceInput, setPriceInput] = useState('');

  const isReady = useMemo(() => Boolean(isConnected && account && readProvider), [
    isConnected,
    account,
    readProvider,
  ]);

  useEffect(() => {
    if (!isReady) return;
    let ignore = false;

    const fetchMyNFTs = async () => {
      setLoading(true);
      setError(null);

      try {
        const nftContract = new ethers.Contract(CONTRACT_ADDRESSES.NFT, NFT_ABI, readProvider);
        const marketContract = new ethers.Contract(
          CONTRACT_ADDRESSES.Marketplace,
          MARKETPLACE_ABI,
          readProvider
        );

        const transferEvents = await nftContract.queryFilter(
          nftContract.filters.Transfer(),
          NFT_QUERY_START_BLOCK,
          'latest'
        );
        const tokenIds = determineOwnedTokenIds(transferEvents, account);

        const results = [];
        for (const tokenId of tokenIds) {
          try {
            const idBigInt = BigInt(tokenId);
            const owner = await nftContract.ownerOf(idBigInt);
            if (owner.toLowerCase() !== account.toLowerCase()) continue;

            let metadata = { tokenURI: '', image: '', name: '', description: '' };
            if (typeof nftContract.tokenURI === 'function') {
              try {
                const uri = await nftContract.tokenURI(idBigInt);
                metadata = await fetchMetadataFromUri(uri);
              } catch (metaErr) {
                console.warn(`tokenId ${tokenId} metadata 解析失败`, metaErr);
              }
            }

            let listingData = { active: false, price: 0n };
            try {
              listingData = await marketContract.listings(CONTRACT_ADDRESSES.NFT, idBigInt);
            } catch (listingErr) {
              console.warn(`读取市场 listing 失败，tokenId=${tokenId}`, listingErr);
            }

            results.push({
              tokenId: Number(tokenId),
              metadata,
              isListed: listingData.active,
              listPrice: listingData.active ? ethers.formatEther(listingData.price) : null,
            });
          } catch (tokenErr) {
            console.error(`读取 token ${tokenId} 失败`, tokenErr);
          }
        }

        if (!ignore) {
          setNfts(results);
        }
      } catch (err) {
        console.error('加载我的 NFT 失败', err);
        if (!ignore) {
          setError(err.message ?? '加载失败');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    fetchMyNFTs();

    return () => {
      ignore = true;
    };
  }, [isReady, account, readProvider]);

  const handleListNFT = async () => {
    if (!signer || !listModal.tokenId) return;
    try {
      setLoading(true);
      const nftContract = new ethers.Contract(CONTRACT_ADDRESSES.NFT, NFT_ABI, signer);
      const marketContract = new ethers.Contract(CONTRACT_ADDRESSES.Marketplace, MARKETPLACE_ABI, signer);

      const approved = await nftContract.isApprovedForAll(account, CONTRACT_ADDRESSES.Marketplace);
      if (!approved) {
        const approveTx = await nftContract.setApprovalForAll(CONTRACT_ADDRESSES.Marketplace, true);
        await approveTx.wait();
      }

      const priceStr = priceInput.trim();
      if (!priceStr || Number(priceStr) <= 0) {
        alert('请输入有效的价格');
        return;
      }
      const price = ethers.parseUnits(priceStr, 18);
      const tx = await marketContract.listNFT(CONTRACT_ADDRESSES.NFT, listModal.tokenId, price);
      await tx.wait();

      setListModal(initialModalState);
      setPriceInput('');
    } catch (err) {
      alert(`上架失败: ${err.message ?? err}`);
      console.error('上架失败', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelListing = async (tokenId) => {
    if (!signer) return;
    try {
      setLoading(true);
      const marketContract = new ethers.Contract(CONTRACT_ADDRESSES.Marketplace, MARKETPLACE_ABI, signer);
      const tx = await marketContract.cancelListing(CONTRACT_ADDRESSES.NFT, tokenId);
      await tx.wait();
    } catch (err) {
      alert(`取消失败: ${err.message ?? err}`);
      console.error('取消上架失败', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="text-center py-16 text-gray-500">
        请先连接钱包以查看您的 NFT
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">我的 NFT</h2>
          <p className="text-sm text-gray-500">当前账户：{account?.slice(0, 6)}...{account?.slice(-4)}</p>
        </div>
        <button
          onClick={() => isReady && !loading && setTimeout(() => window.location.reload(), 50)}
          className="px-4 py-2 text-sm rounded-md border hover:bg-gray-50 transition"
        >
          刷新
        </button>
      </header>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
      )}

      {loading && nfts.length === 0 ? (
        <div className="text-center py-16 text-gray-500">加载中...</div>
      ) : nfts.length === 0 ? (
        <div className="text-center py-16 text-gray-500">您还没有任何 NFT</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {nfts.map((nft) => (
            <article
              key={nft.tokenId}
              className="border rounded-lg p-4 space-y-3 hover:shadow-md transition-shadow"
            >
              <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center">
                {nft.metadata.image ? (
                  <img
                    src={nft.metadata.image}
                    alt={`NFT #${nft.tokenId}`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <span className="text-gray-400">NFT #{nft.tokenId}</span>
                )}
              </div>
              <div>
                <p className="text-sm text-gray-500">Token ID</p>
                <p className="font-semibold text-lg">#{nft.tokenId}</p>
                {nft.metadata.name && (
                  <p className="text-sm text-gray-600 mt-1">{nft.metadata.name}</p>
                )}
              </div>
              {nft.isListed ? (
                <div className="space-y-2">
                  <p className="text-sm text-green-600">已上架</p>
                  <p className="font-bold text-blue-600">{nft.listPrice} C5D</p>
                  <button
                    disabled={loading}
                    onClick={() => handleCancelListing(nft.tokenId)}
                    className="w-full px-4 py-2 rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                  >
                    取消上架
                  </button>
                </div>
              ) : (
                <button
                  disabled={loading}
                  onClick={() => setListModal({ visible: true, tokenId: nft.tokenId })}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
                >
                  <Upload size={16} />
                  上架出售
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {listModal.visible && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-6">
            <header className="flex items-center justify-between">
              <h3 className="text-xl font-semibold">上架 NFT</h3>
              <button onClick={() => setListModal(initialModalState)}>
                <X size={22} className="text-gray-500 hover:text-gray-700" />
              </button>
            </header>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">NFT ID</p>
                <p className="text-lg font-semibold">#{listModal.tokenId}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  价格（C5D）
                </label>
                <input
                  type="text"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  className="w-full border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入出售价格"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleListNFT}
                  disabled={loading || !priceInput}
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
                >
                  {loading ? '处理中...' : '确认上架'}
                </button>
                <button
                  onClick={() => {
                    setListModal(initialModalState);
                    setPriceInput('');
                  }}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
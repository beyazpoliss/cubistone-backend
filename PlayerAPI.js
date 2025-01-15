import { Player } from './models/Player.js';

class PlayerAPI {
  constructor(config) {
    this.config = config;
  }

  async getInventory(req, res) {
    try {
      const player = await Player.findOne({ playerId: req.params.id });
      if (!player) {
        return res.status(404).json({ error: 'Oyuncu bulunamadı' });
      }
      res.json(player.inventory);
    } catch (error) {
      console.error('Oyuncu envanteri alınırken hata:', error);
      res.status(500).json({ error: 'Sunucu hatası' });
    }
  }

  async getCoins(req, res) {
    try {
      const player = await Player.findOne({ playerId: req.params.id });
      if (!player) {
        return res.status(404).json({ error: 'Oyuncu bulunamadı' });
      }
      res.json({ coins: player.coins });
    } catch (error) {
      console.error('Oyuncu coin bilgisi alınırken hata:', error);
      res.status(500).json({ error: 'Sunucu hatası' });
    }
  }

  async useProduct(req, res) {
    try {
      const playerId = req.params.id;
      const productId = req.params.productId;

      const player = await Player.findOne({ playerId });
      if (!player) {
        return res.status(404).json({ error: 'Oyuncu bulunamadı' });
      }

      const inventoryItemIndex = player.inventory.findIndex(
        item => item.productId === productId
      );

      if (inventoryItemIndex === -1) {
        return res.status(404).json({ error: 'Ürün bulunamadı' });
      }

      const product = this.config.products.find(p => p.id === productId);
      if (!product) {
        return res.status(404).json({ error: 'Ürün yapılandırması bulunamadı' });
      }

      player.inventory.splice(inventoryItemIndex, 1);
      await player.save();

      const commands = product.commands.map(cmd =>
        cmd.replace('{player}', playerId)
      );

      res.json({ commands });
    } catch (error) {
      console.error('Ürün kullanılırken hata:', error);
      res.status(500).json({ error: 'Sunucu hatası' });
    }
  }
}

export default PlayerAPI;
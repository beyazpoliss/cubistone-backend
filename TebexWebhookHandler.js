import { Player } from './models/Player.js';

class TebexWebhookHandler {
  constructor(validator, config) {
    this.validator = validator;
    this.config = config;
  }

  async handleWebhook(req, res) {
    if (!this.validator.validateTebexIP(req)) {
      console.log('Geçersiz IP adresi:', req.ip || req.connection.remoteAddress);
      return res.status(404).send();
    }

    const signature = req.headers['x-signature'];
    if (!signature || !this.validator.validateSignature(req.rawBody, signature)) {
      console.log('Geçersiz imza');
      return res.status(403).json({ error: 'Geçersiz imza' });
    }

    if (req.body.type === 'validation.webhook') {
      console.log('Validation webhook alındı. ID:', req.body.id);
      return res.status(200).json({ id: req.body.id });
    }

    if (req.body.type === 'payment.completed') {
      try {
        const transaction = req.body.subject;

        for (const product of transaction.products) {
          const playerId = product.username.id;
          const packageId = product.id.toString();
          const price = parseFloat(product.paid_price.amount);

          let player = await Player.findOne({ playerId });
          if (!player) {
            player = new Player({ playerId });
          }

          player.coins += price;
          player.inventory.push({
            productId: packageId,
            purchaseDate: new Date()
          });

          await player.save();
          console.log(`Yeni satın alma: Oyuncu ${playerId}, Paket ${packageId}, Fiyat ${price}`);
        }

        res.status(200).json({ success: true });
      } catch (error) {
        console.error('Webhook işleme hatası:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
      }
    } else {
      res.status(200).json({ success: true, message: 'Webhook alındı, işlem yapılmadı.' });
    }
  }
}

export default TebexWebhookHandler;
import express from 'express';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readFile } from 'fs/promises';
import crypto from 'crypto';
import chalk from 'chalk';
import figlet from 'figlet';
import boxen from 'boxen';
import Table from 'cli-table3';
import moment from 'moment';

// ES modules için __filename ve __dirname tanımlama
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// İstatistik takibi için global değişkenler
let stats = {
  totalTransactions: 0,
  totalCoins: 0,
  activeUsers: new Set(),
  lastTransactions: [],
  startTime: new Date()
};

// Config dosyasını asenkron olarak oku
const config = JSON.parse(
  await readFile(new URL('./config.json', import.meta.url))
);

// Player modelini tanımla
const playerSchema = new mongoose.Schema({
  playerId: { type: String, required: true, unique: true },
  coins: { type: Number, default: 0 },
  inventory: [{
    productId: String,
    purchaseDate: { type: Date, default: Date.now }
  }]
});

const Player = mongoose.model('Player', playerSchema);

// Express uygulamasını oluştur
const app = express();

// Raw body'yi saklamak için middleware
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Konsol temizleme fonksiyonu
function clearConsole() {
  process.stdout.write('\x1Bc');
}

// Para formatı
function formatCurrency(amount) {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
}

// Uptime hesaplama
function getUptime() {
  const diff = moment().diff(moment(stats.startTime));
  return moment.duration(diff).humanize();
}

// Konsol görüntüsünü güncelle
function updateDisplay() {
  clearConsole();

  // Header
  console.log(chalk.cyan(figlet.textSync('Cubistone', {
    font: 'Small',
    horizontalLayout: 'full'
  })));

  console.log(chalk.dim('⚡ Server Dashboard - ' + moment().format('YYYY-MM-DD HH:mm:ss')));
  console.log();

  // Sunucu durumu
  const serverStatus = boxen(
    chalk.green('✓ Server Online\n') +
      chalk.blue(`◆ Port: ${PORT}\n`) +
      chalk.yellow(`◆ MongoDB: Connected\n`) +
      chalk.magenta(`◆ Active Users: ${stats.activeUsers.size}\n`) +
      chalk.cyan(`◆ Uptime: ${getUptime()}`),
    {
      padding: 1,
      margin: 0,
      borderStyle: 'round',
      borderColor: 'blue',
      title: 'System Status',
      titleAlignment: 'center'
    }
  );
  console.log(serverStatus);
  console.log();

  // İstatistikler
  const statsBox = boxen(
    chalk.yellow(`📊 Total Transactions: ${stats.totalTransactions}\n`) +
      chalk.green(`💰 Total Coins: ${stats.totalCoins}`),
    {
      padding: 1,
      margin: 0,
      borderStyle: 'round',
      borderColor: 'yellow',
      title: 'Statistics',
      titleAlignment: 'center'
    }
  );
  console.log(statsBox);
  console.log();

  // Son işlemler tablosu
  const table = new Table({
    head: [
      chalk.cyan('Time'),
      chalk.cyan('Player'),
      chalk.cyan('Package'),
      chalk.cyan('Amount'),
      chalk.cyan('Coins')
    ],
    style: {
      head: [],
      border: []
    }
  });

  stats.lastTransactions.forEach(tx => {
    table.push([
      moment(tx.time).format('HH:mm:ss'),
      chalk.yellow(tx.player.substring(0, 8) + '...'),
      chalk.green(tx.package),
      chalk.blue(formatCurrency(tx.amount)),
      chalk.magenta(tx.coins)
    ]);
  });

  console.log(chalk.bold('📝 Recent Transactions'));
  console.log(table.toString());
}

// MongoDB bağlantısı
mongoose.connect(config.mongodb.uri)
  .then(() => {
    console.log(chalk.green('✓ MongoDB connection successful'));
    updateDisplay();
  })
  .catch(err => console.error(chalk.red('MongoDB connection error:', err)));

// Tebex IP adresleri
const TEBEX_IPS = ['18.209.80.3', '54.87.231.232'];

// IP doğrulama
function validateTebexIP(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = forwardedFor ? forwardedFor.split(',')[0] : req.connection.remoteAddress;
  return TEBEX_IPS.includes(ip);
}

// HMAC imza doğrulama
function validateSignature(rawBody, signature, secret) {
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(bodyHash)
    .digest('hex');
  return signature === expectedSignature;
}

// UUID formatına çevirme fonksiyonu
function formatUUID(id) {
  if (id.length === 32) {
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  }
  return id; // Zaten UUID formatındaysa veya hatalıysa dokunma
}

// Tebex webhook endpoint'i
app.post('/webhook/tebex', async (req, res) => {
  if (!validateTebexIP(req)) {
    console.log(chalk.red('⚠ Invalid IP:', req.ip));
    return res.status(404).send();
  }

  const signature = req.headers['x-signature'];
  if (!signature || !validateSignature(req.rawBody, signature, config.tebex.secret)) {
    console.log(chalk.red('⚠ Invalid signature'));
    return res.status(403).json({ error: 'Invalid signature' });
  }

  if (req.body.type === 'validation.webhook') {
    console.log(chalk.green('✓ Validation webhook received. ID:', req.body.id));
    updateDisplay();
    return res.status(200).json({ id: req.body.id });
  }

  if (req.body.type === 'payment.completed') {
    try {
      const transaction = req.body.subject;

      if (Array.isArray(transaction.products)) {
        for (const productData of transaction.products) {
          // UUID formatına çevir
          const playerId = formatUUID(transaction.customer.username.id);
          const packageId = productData.id.toString();
          const purchasedPackage = config.packages.find(p => p.tebexId === packageId);

          if (!purchasedPackage) {
            console.log(chalk.red('⚠ Package not found:', packageId));
            continue;
          }

          // İstatistikleri güncelle
          stats.totalTransactions++;
          stats.totalCoins += purchasedPackage.amount;
          stats.activeUsers.add(playerId);

          // Son işlemleri güncelle
          stats.lastTransactions.unshift({
            time: new Date(),
            player: playerId,
            package: purchasedPackage.name,
            amount: transaction.price.amount,
            coins: purchasedPackage.amount
          });

          // Son 5 işlemi tut
          if (stats.lastTransactions.length > 5) {
            stats.lastTransactions.pop();
          }

          // Oyuncu veritabanını güncelle
          let player = await Player.findOne({ playerId });
          if (!player) {
            player = new Player({ playerId });
          }
          player.coins += purchasedPackage.amount;
          await player.save();

          updateDisplay();
        }
      }

      res.status(200).json({ success: true });
    } catch (error) {
      console.error(chalk.red('⚠ Webhook error:', error));
      res.status(500).json({ error: 'Server error' });
    }
  } else {
    res.status(200).json({ success: true, message: 'Webhook received' });
  }
});

app.get('/player/:id/inventory', async (req, res) => {
  try {
    // UUID formatına çevir
    const playerId = formatUUID(req.params.id);
    const serverType = req.query.server_type; // server_type parametresini al

    const player = await Player.findOne({ playerId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Envanterdeki ürünleri config.products listesinden প্রোডাক্ট nesnelerine dönüştür
    const inventoryProducts = player.inventory.map(item => {
      const productConfig = config.products.find(p => p.id === item.productId);
      return {
        id: productConfig.id,
        price: productConfig.price,
        server_type: productConfig.server_type,
        product_type: productConfig.product_type,
        purchaseDate: item.purchaseDate // Satın alma tarihini de ekle
      };
    });

    // server_type parametresine göre filtrele
    const filteredInventory = serverType
      ? inventoryProducts.filter(product => product.server_type === serverType)
      : inventoryProducts;

    res.json(filteredInventory);
  } catch (error) {
    console.error(chalk.red('⚠ Inventory error:', error));
    res.status(500).json({ error: 'Server error' });
  }
});
// Coin bilgisi endpoint'i
app.get('/player/:id/coins', async (req, res) => {
  try {
    // UUID formatına çevir
    const playerId = formatUUID(req.params.id);
    const player = await Player.findOne({ playerId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    res.json({ coins: player.coins });
  } catch (error) {
    console.error(chalk.red('⚠ Coins error:', error));
    res.status(500).json({ error: 'Server error' });
  }
});

// Ürün kullanma endpoint'i (GERİ EKLENDİ)
app.post('/player/:id/use/:productId', async (req, res) => {
  try {
    // UUID formatına çevir
    const playerId = formatUUID(req.params.id);
    const productId = req.params.productId;

    const player = await Player.findOne({ playerId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const inventoryItemIndex = player.inventory.findIndex(
      item => item.productId === productId
    );

    if (inventoryItemIndex === -1) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Ürünü envanterden kaldır
    player.inventory.splice(inventoryItemIndex, 1);
    await player.save();

    // Burada komut çalıştırma gibi işlemler yapılabilir, ancak şu an için boş
    // response olarak sadece mesaj gönderiyoruz
    res.json({ message: 'Product used successfully' }); 
  } catch (error) {
    console.error(chalk.red('⚠ Use product error:', error));
    res.status(500).json({ error: 'Server error' });
  }
});

// Ürünleri filtreleme endpoint'i
app.get('/products', async (req, res) => {
  try {
    const serverType = req.query.server_type;
    const productType = req.query.product_type;

    let filteredProducts = config.products;

    if (serverType) {
      filteredProducts = filteredProducts.filter(p => p.server_type === serverType);
    }

    if (productType) {
      filteredProducts = filteredProducts.filter(p => p.product_type === productType);
    }

    res.json(filteredProducts);
  } catch (error) {
    console.error(chalk.red('⚠ Products error:', error));
    res.status(500).json({ error: 'Server error' });
  }
});

// Coin ile ürün alma endpoint'i
app.post('/player/:id/buy/:productId', async (req, res) => {
  try {
    // UUID formatına çevir
    const playerId = formatUUID(req.params.id);
    const productId = req.params.productId;

    const player = await Player.findOne({ playerId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const product = config.products.find(p => p.id === productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (player.coins < product.price) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    player.coins -= product.price;
    player.inventory.push({
      productId: productId,
      purchaseDate: new Date()
    });

    await player.save();

    // İstatistikleri güncelle
    stats.activeUsers.add(playerId);
    updateDisplay();

    res.json({ message: 'Purchase successful', coins: player.coins });
  } catch (error) {
    console.error(chalk.red('⚠ Buy product error:', error));
    res.status(500).json({ error: 'Server error' });
  }
});

// Oyuncu profili oluşturma veya kontrol etme endpoint'i
app.post('/player/:id/create', async (req, res) => {
  try {
    // UUID formatına çevir
    const playerId = formatUUID(req.params.id);

    // Oyuncu profilini veritabanında ara
    let player = await Player.findOne({ playerId });

    // Oyuncu profili yoksa yeni bir profil oluştur
    if (!player) {
      player = new Player({
        playerId,
        coins: 0, // Varsayılan olarak 0 coin ile başla
        inventory: [] // Varsayılan olarak boş envanter ile başla
      });

      // Profili veritabanına kaydet
      await player.save();

      console.log(chalk.green(`✓ New player profile created for: ${playerId}`));
      // Başarılı cevaba oluşturulan profil bilgisini ekleyelim
      res.status(201).json({ 
        message: 'Player profile created successfully',
        player: {
          playerId: player.playerId,
          coins: player.coins,
          inventory: player.inventory
        }
      });
    } else {
      console.log(chalk.yellow(`✓ Player profile already exists for: ${playerId}`));
      // Oyuncu zaten varsa bilgilendirme mesajı döndürelim
      res.status(200).json({
        message: 'Player profile already exists',
        player: {
          playerId: player.playerId,
          coins: player.coins,
          inventory: player.inventory
        }
      });
    }
  } catch (error) {
    console.error(chalk.red('⚠ Create player profile error:', error));
    res.status(500).json({ error: 'Server error' });
  }
});

// Item transfer endpoint'i
app.post('/player/:senderId/transfer/item/:receiverId', async (req, res) => {
  try {
    const senderId = formatUUID(req.params.senderId);
    const receiverId = formatUUID(req.params.receiverId);
    const { productId } = req.body;

    // Aynı kişiye transfer kontrolü
    if (senderId === receiverId) {
      return res.status(400).json({ error: 'Cannot transfer to yourself' });
    }

    // productId kontrolü
    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    const sender = await Player.findOne({ playerId: senderId });
    const receiver = await Player.findOne({ playerId: receiverId });

    if (!sender || !receiver) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const inventoryItemIndex = sender.inventory.findIndex(item => item.productId === productId);

    if (inventoryItemIndex === -1) {
      return res.status(404).json({ error: 'Product not found in sender inventory' });
    }

    const item = sender.inventory.splice(inventoryItemIndex, 1)[0];
    receiver.inventory.push(item);

    await sender.save();
    await receiver.save();

    // Başarılı cevaba daha detaylı bilgi ekleyelim
    res.json({ 
      message: 'Item transferred successfully',
      transferredItem: {
        productId: item.productId,
        transferDate: new Date()
      }
    });
  } catch (error) {
    console.error(chalk.red('⚠ Item transfer error:', error));
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/player/:senderId/transfer/coins/:receiverId', async (req, res) => {
  try {
      const senderId = formatUUID(req.params.senderId);
      const receiverId = formatUUID(req.params.receiverId);
      const { amount } = req.body;

      // Validate input
      if (!amount || amount <= 0) {
          return res.status(400).json({ error: 'Invalid amount' });
      }

      // Find players
      const sender = await Player.findOne({ playerId: senderId });
      const receiver = await Player.findOne({ playerId: receiverId });

      if (!sender || !receiver) {
          return res.status(404).json({ error: 'Player not found' });
      }

      if (sender.coins < amount) {
          return res.status(400).json({ error: 'Insufficient coins' });
      }

      // Perform transfer
      await Player.updateOne(
          { playerId: senderId },
          { $inc: { coins: -amount } }
      );

      await Player.updateOne(
          { playerId: receiverId },
          { $inc: { coins: amount } }
      );

      // Log successful transfer
      console.log(`Successfully transferred ${amount} coins from ${senderId} to ${receiverId}`);
      
      // Get updated balances
      const updatedSender = await Player.findOne({ playerId: senderId });
      const updatedReceiver = await Player.findOne({ playerId: receiverId });
      
      res.json({ 
          message: 'Coins transferred successfully',
          senderBalance: updatedSender.coins,
          receiverBalance: updatedReceiver.coins
      });

  } catch (error) {
      console.error('⚠ Coin transfer error:', error);
      res.status(500).json({ error: 'Server error occurred during transfer' });
  }
});

// Display'i her dakika güncelle
setInterval(updateDisplay, 60000);

// Sunucuyu başlat
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(chalk.green(`✓ Server running on port ${PORT}`));
  updateDisplay();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(chalk.yellow('🛑 Shutting down...'));
  process.exit(0);
});
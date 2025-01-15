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
import axios from 'axios';
import cors from 'cors';

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

// MongoDB Connection Configuration
const MONGODB_URI = 'mongodb+srv://cteknoloji1967:x%40PQDDW-.LF6F-k@cubistone.9bkul.mongodb.net/?retryWrites=true&w=majority&appName=Cubistone';

const mongooseOptions = {
  // Remove deprecated options
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4,
  maxPoolSize: 50,
  minPoolSize: 10,
  retryWrites: true,
  retryReads: true
};
// MongoDB connection with retry logic
async function connectToMongoDB() {
  let retries = 5;
  
  while (retries > 0) {
    try {
      console.log(chalk.yellow('📡 Attempting MongoDB connection...'));
      await mongoose.connect(MONGODB_URI, mongooseOptions);
      
      console.log(chalk.green('✓ MongoDB connection successful'));
      
      // Set up connection event handlers
      mongoose.connection.on('error', (err) => {
        console.error(chalk.red('MongoDB connection error:', err));
        updateDisplay();
      });

      mongoose.connection.on('disconnected', () => {
        console.log(chalk.yellow('🔌 MongoDB disconnected'));
        updateDisplay();
      });

      mongoose.connection.on('reconnected', () => {
        console.log(chalk.green('✓ MongoDB reconnected'));
        updateDisplay();
      });

      // Initial display update
      updateDisplay();
      return;
      
    } catch (error) {
      console.error(chalk.red(`MongoDB connection attempt failed (${retries} retries left):`, error.message));
      retries--;
      
      if (retries === 0) {
        console.error(chalk.red('❌ Failed to connect to MongoDB after all retries'));
        process.exit(1);
      }
      
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, (5 - retries) * 2000));
    }
  }
}

// Config dosyasını asenkron olarak oku
const config = JSON.parse(
  await readFile(new URL('./config.json', import.meta.url))
);

// Tebex API anahtarını config dosyasından al
const PRIVATE_KEY = config.tebex.privateKey;
const PUBLIC_KEY = config.tebex.publicKey;
const PROJECT_ID = config.tebex.projectId;
const BASE_URL = config.tebex.baseUrl;
const SECRET = config.tebex.secret;

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

// CORS ayarları
app.use(cors({
  origin: 'http://localhost:3000' // Sadece kendi frontend'inizin origin'ine izin verin!
}));

// Raw body'yi saklamak için middleware
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Tebex API İstemcisi
const tebexApi = axios.create({
  baseURL: BASE_URL,
  auth: {
    username: PROJECT_ID,
    password: PRIVATE_KEY
  },
  headers: {
    'Content-Type': 'application/json',
  }
});

const pluginApi = axios.create({
  baseURL: 'https://plugin.tebex.io',
  headers: {
    'X-Tebex-Secret': SECRET,
    'Content-Type': 'application/json',
  },
});

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
  return id;
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
          const playerId = formatUUID(transaction.customer.username.id);
          const packageId = productData.id.toString();
          const purchasedPackage = config.packages.find(p => p.tebexId === packageId);

          if (!purchasedPackage) {
            console.log(chalk.red('⚠ Package not found:', packageId));
            continue;
          }

          stats.totalTransactions++;
          stats.totalCoins += purchasedPackage.amount;
          stats.activeUsers.add(playerId);

          stats.lastTransactions.unshift({
            time: new Date(),
            player: playerId,
            package: purchasedPackage.name,
            amount: transaction.price.amount,
            coins: purchasedPackage.amount
          });

          if (stats.lastTransactions.length > 5) {
            stats.lastTransactions.pop();
          }

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

// Paketleri getiren endpoint
app.get('/api/packages', async (req, res) => {
  try {
    const tebexResponse = await tebexApi.get(`/accounts/${PUBLIC_KEY}/packages`);

    if (tebexResponse.data && tebexResponse.data.data) {
      const transformedPackages = tebexResponse.data.data.map(pack => ({
        ...pack,
        price: parseFloat(pack.total_price),
        image: pack.image,
      }));
      res.json(transformedPackages);
    } else {
      res.status(500).json({ error: 'Failed to fetch packages' });
    }
  } catch (error) {
    console.error("Failed to fetch packages:", error);
    res.status(500).json({ error: "Failed to load store packages. Please try again later." });
  }
});

// Sepet oluşturma endpoint'i
app.post('/api/checkout', async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    const tebexResponse = await tebexApi.post(`/accounts/${PUBLIC_KEY}/baskets`, {
      username: username,
      complete_url: `http://localhost:3000`,
      cancel_url: `http://localhost:3000`,
      complete_auto_redirect: true
    });

    if (!tebexResponse.data?.data?.ident) {
      throw new Error('Invalid basket response');
    }

    res.json({ basketId: tebexResponse.data.data.ident });
  } catch (error) {
    console.error('Checkout error:', error);
    console.error('Error response:', error.response?.data);

    let errorMessage = 'An error occurred during checkout. Please try again.';

    if (error.response?.data?.error) {
      errorMessage = error.response.data.error;
    } else if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    } else if (error.response?.data?.title) {
      errorMessage = error.response.data.title;
    }

    res.status(500).json({ error: errorMessage });
  }
});

// Sepete ürün ekleme endpoint'i
app.post('/api/basket/:basketId/packages', async (req, res) => {
  const { basketId } = req.params;
  const { package_id, quantity } = req.body;

  try {
    await tebexApi.post(`/baskets/${basketId}/packages`, {
      package_id,
      quantity
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Add to basket error:', error);
    console.error('Error response:', error.response?.data);

    let errorMessage = 'An error occurred while adding to basket. Please try again.';

    if (error.response?.data?.error) {
      errorMessage = error.response.data.error;
    } else if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    } else if (error.response?.data?.title) {
      errorMessage = error.response.data.title;
    }

    res.status(500).json({ error: errorMessage });
  }
});

// Envanter endpoint'i
app.get('/player/:id/inventory', async (req, res) => {
  try {
    const playerId = formatUUID(req.params.id);
    const serverType = req.query.server_type;

    const player = await Player.findOne({ playerId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const inventoryProducts = player.inventory.map(item => {
      const productConfig = config.products.find(p => p.id === item.productId);
      return {
        id: productConfig.id,
        price: productConfig.price,
        server_type: productConfig.server_type,
        product_type: productConfig.product_type,
        purchaseDate: item.purchaseDate
      };
    });

    const filteredInventory = serverType
      ? inventoryProducts.filter(product => product.server_type === serverType)
      : inventoryProducts;

    res.json(filteredInventory);

  } catch (error) {
    console.error(chalk.red('⚠ Inventory error:', error));
    res.status(500).json({ error: 'Server error' });
  }
});

// Oyuncu coin bilgisini getiren endpoint
app.get('/player/:id/coins', async (req, res) => {
  try {
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

// Ürün kullanma endpoint'i
app.post('/player/:id/use/:productId', async (req, res) => {
  try {
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

    player.inventory.splice(inventoryItemIndex, 1);
    await player.save();

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
    const playerId = formatUUID(req.params.id);

    let player = await Player.findOne({ playerId });

    if (!player) {
      player = new Player({
        playerId,
        coins: 0,
        inventory: []
      });

      await player.save();

      console.log(chalk.green(`✓ New player profile created for: ${playerId}`));
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

    if (senderId === receiverId) {
      return res.status(400).json({ error: 'Cannot transfer to yourself' });
    }

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

// Coin transfer endpoint'i
app.post('/player/:senderId/transfer/coins/:receiverId', async (req, res) => {
  try {
    const senderId = formatUUID(req.params.senderId);
    const receiverId = formatUUID(req.params.receiverId);
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const sender = await Player.findOne({ playerId: senderId });
    const receiver = await Player.findOne({ playerId: receiverId });

    if (!sender || !receiver) {
      return res.status(404).json({ error: 'Player not found' });
    }

    if (sender.coins < amount) {
      return res.status(400).json({ error: 'Insufficient coins' });
    }

    await Player.updateOne(
      { playerId: senderId },
      { $inc: { coins: -amount } }
    );

    await Player.updateOne(
      { playerId: receiverId },
      { $inc: { coins: amount } }
    );

    console.log(`Successfully transferred ${amount} coins from ${senderId} to ${receiverId}`);

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

// Initialize MongoDB connection
connectToMongoDB().catch(error => {
  console.error(chalk.red('Fatal MongoDB connection error:', error));
  process.exit(1);
});

// Add graceful shutdown for MongoDB
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    console.log(chalk.yellow('MongoDB connection closed through app termination'));
    process.exit(0);
  } catch (err) {
    console.error(chalk.red('Error during MongoDB disconnection:', err));
    process.exit(1);
  }
});

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
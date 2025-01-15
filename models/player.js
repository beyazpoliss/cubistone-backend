import mongoose from 'mongoose';

const playerSchema = new mongoose.Schema({
  playerId: { 
    type: String, 
    required: true, 
    unique: true 
  },
  coins: { 
    type: Number, 
    default: 0 
  },
  inventory: [{
    productId: String,
    purchaseDate: Date
  }]
});

export const Player = mongoose.model('Player', playerSchema);
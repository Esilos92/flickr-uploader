// index.js
import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { OAuth } from 'oauth';

const app = express();
app.use(express.json());

const oauth = new OAuth(
  'https://www.flickr.com/services/oauth/request_token',
  'https://www.flickr.com/services/oauth/access_token',
  process.env.FLICKR_API_KEY,
  process.env.FLICKR_API_SECRET,
  '1.0',
  'oob',
  'HMAC-SHA1'
);

app.post('/upload', async (req, res) => {
  const { imageUrl, title = '', description = '' } = req.body;

  if (!imageUrl) {
    return res.status(400).json({ error: 'Missing imageUrl' });
  }

  try {
    const imageResponse = await axios.get(imageUrl, { responseType: 'stream' });

    const form = new FormData();
    form.append('photo', imageResponse.data, { filename: 'image.jpg' });
    form.append('title', title);
    form.append('description', description);
    form.append('is_public', '0'); // private by default

    const uploadUrl = 'https://up.flickr.com/services/upload/';

    const oauthHeader = oauth._prepareParameters(
      process.env.FLICKR_ACCESS_TOKEN,
      process.env.FLICKR_ACCESS_SECRET,
      'POST',
      uploadUrl
    );

    const headers = {
      ...form.getHeaders(),
      Authorization: oauthHeader.map(v => v.join('=')).join(', '),
    };

    const uploadResponse = await axios.post(uploadUrl, form, { headers });
    res.status(200).send(uploadResponse.data);
  } catch (err) {
    console.error('Upload failed:', err.message);
    res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Uploader running on port ${PORT}`);
});

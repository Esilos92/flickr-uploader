import express from 'express';
import axios from 'axios';
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import FormData from 'form-data';

const app = express();
app.use(express.json());

const FLICKR_API_KEY = process.env.FLICKR_API_KEY;
const FLICKR_API_SECRET = process.env.FLICKR_API_SECRET;
const FLICKR_ACCESS_TOKEN = process.env.FLICKR_ACCESS_TOKEN;
const FLICKR_ACCESS_SECRET = process.env.FLICKR_ACCESS_SECRET;

const oauth = new OAuth({
  consumer: { key: FLICKR_API_KEY, secret: FLICKR_API_SECRET },
  signature_method: 'HMAC-SHA1',
  hash_function(base, key) {
    return crypto.createHmac('sha1', key).update(base).digest('base64');
  },
});

const token = {
  key: FLICKR_ACCESS_TOKEN,
  secret: FLICKR_ACCESS_SECRET,
};

app.post('/upload', async (req, res) => {
  const { dropboxUrl, title, description = '', albumTitle } = req.body;
  if (!dropboxUrl || !albumTitle) {
    return res.status(400).json({ error: 'Missing dropboxUrl or albumTitle' });
  }

  try {
    // Step 1: Download image
    const imageResponse = await axios.get(dropboxUrl, { responseType: 'stream' });

    // Step 2: Prepare upload form
    const form = new FormData();
    form.append('photo', imageResponse.data, { filename: 'upload.jpg' });
    form.append('title', title);
    form.append('description', description);
    form.append('is_public', '0');

    // Step 3: Sign upload request
    const uploadUrl = 'https://up.flickr.com/services/upload/';
    const authHeader = oauth.toHeader(oauth.authorize({ url: uploadUrl, method: 'POST' }, token));

    const uploadResponse = await axios.post(uploadUrl, form, {
      headers: {
        ...form.getHeaders(),
        ...authHeader,
      },
    });

    const responseData = await new Promise((resolve, reject) => {
      let xml = '';
      uploadResponse.data.on('data', chunk => (xml += chunk));
      uploadResponse.data.on('end', () => resolve(xml));
      uploadResponse.data.on('error', reject);
    });

    const photoIdMatch = responseData.match(/<photoid>(\d+)<\/photoid>/);
    if (!photoIdMatch) throw new Error('No photoid returned');
    const photoId = photoIdMatch[1];

    // Step 4: Check for existing album
    const albumsUrl = 'https://api.flickr.com/services/rest/';
    const albumsParams = {
      method: 'flickr.photosets.getList',
      format: 'json',
      nojsoncallback: '1',
    };

    const albumsAuth = oauth.toHeader(oauth.authorize(
      { url: albumsUrl, method: 'GET', data: albumsParams },
      token
    ));

    const albumListRes = await axios.get(albumsUrl, {
      headers: { ...albumsAuth },
      params: { ...albumsParams, oauth_consumer_key: FLICKR_API_KEY },
    });

    const existingAlbum = albumListRes.data.photosets.photoset.find(set =>
      set.title._content.toLowerCase() === albumTitle.toLowerCase()
    );

    let albumId;
    if (existingAlbum) {
      albumId = existingAlbum.id;
    } else {
      // Step 5: Create new album
      const createParams = {
        method: 'flickr.photosets.create',
        format: 'json',
        nojsoncallback: '1',
        title: albumTitle,
        primary_photo_id: photoId,
      };

      const createAuth = oauth.toHeader(oauth.authorize(
        { url: albumsUrl, method: 'POST', data: createParams },
        token
      ));

      const createRes = await axios.post(albumsUrl, null, {
        headers: { ...createAuth },
        params: { ...createParams, oauth_consumer_key: FLICKR_API_KEY },
      });

      albumId = createRes.data.photoset.id;
    }

    // Step 6: Add photo to album (if not already added during create)
    if (existingAlbum) {
      const addParams = {
        method: 'flickr.photosets.addPhoto',
        format: 'json',
        nojsoncallback: '1',
        photoset_id: albumId,
        photo_id: photoId,
      };

      const addAuth = oauth.toHeader(oauth.authorize(
        { url: albumsUrl, method: 'POST', data: addParams },
        token
      ));

      await axios.post(albumsUrl, null, {
        headers: { ...addAuth },
        params: { ...addParams, oauth_consumer_key: FLICKR_API_KEY },
      });
    }

    return res.status(200).json({ success: true, photoId, albumId });
  } catch (err) {
    console.error('Upload failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Uploader running on port ${PORT}`));

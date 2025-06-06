// index.js
import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import upload from 'flickr-sdk/upload.js';
import Flickr from 'flickr-sdk';

const app = express();
app.use(express.json());

const flickr = new Flickr(
  Flickr.OAuth.createPlugin(
    process.env.FLICKR_API_KEY,
    process.env.FLICKR_API_SECRET,
    process.env.FLICKR_ACCESS_TOKEN,
    process.env.FLICKR_ACCESS_SECRET
  )
);

app.post('/upload', async (req, res) => {
  const { dropboxUrl, title = '', description = '', albumTitle = '' } = req.body;

  if (!dropboxUrl || !albumTitle) {
    return res.status(400).json({ error: 'Missing dropboxUrl or albumTitle' });
  }

  try {
    // Get image stream
    const imageResponse = await axios.get(dropboxUrl, { responseType: 'stream' });

    // Upload to Flickr
    const uploadResponse = await upload(
      {
        photo: imageResponse.data,
        title,
        description,
        is_public: 0 // keep private
      },
      process.env.FLICKR_ACCESS_TOKEN,
      process.env.FLICKR_ACCESS_SECRET
    );

    const photoId = uploadResponse.body.photoid._content;

    // Get or create album
    const { body: { photosets } } = await flickr.photosets.getList();
    let album = photosets.photoset.find(ps => ps.title._content === albumTitle);

    if (!album) {
      const created = await flickr.photosets.create({
        title: albumTitle,
        primary_photo_id: photoId
      });
      album = created.body.photoset;
    } else {
      await flickr.photosets.addPhoto({
        photoset_id: album.id,
        photo_id: photoId
      });
    }

    res.status(200).json({ success: true, photoId, albumId: album.id });
  } catch (err) {
    console.error('Upload failed:', err);
    res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Uploader running on port ${PORT}`));

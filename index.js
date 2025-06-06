import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import Flickr from 'flickr-sdk';

const app = express();
app.use(express.json());

// Load Flickr OAuth plugin
const flickr = new Flickr(Flickr.OAuth.createPlugin(
  process.env.FLICKR_API_KEY,
  process.env.FLICKR_API_SECRET,
  process.env.FLICKR_ACCESS_TOKEN,
  process.env.FLICKR_ACCESS_SECRET
));

// Route to handle uploads
app.post('/upload', async (req, res) => {
  const { dropboxUrl, title = '', description = '', albumTitle = '' } = req.body;

  if (!dropboxUrl || !albumTitle) {
    return res.status(400).json({ error: 'Missing dropboxUrl or albumTitle' });
  }

  try {
    // Fetch image data from Dropbox shared link
    const imageResponse = await axios.get(dropboxUrl, { responseType: 'stream' });

    // Prepare form data for Flickr upload
    const form = new FormData();
    form.append('photo', imageResponse.data, { filename: 'upload.jpg' });
    form.append('title', title);
    form.append('description', description);
    form.append('is_public', '0'); // always private

    // Upload photo to Flickr
    const uploadResponse = await flickr.upload(form);

    const photoId = uploadResponse.body.photoid._content;

    // Check for existing album
    let albumId;
    const albums = await flickr.photosets.getList({ user_id: 'me' });
    const match = albums.body.photosets.photoset.find(ps => ps.title._content === albumTitle);

    if (match) {
      albumId = match.id;
    } else {
      // Create new album with first photo
      const album = await flickr.photosets.create({
        title: albumTitle,
        primary_photo_id: photoId
      });
      albumId = album.body.photoset.id;
    }

    // Add photo to album (if not already primary)
    if (!match) {
      // Already added during creation
    } else {
      await flickr.photosets.addPhoto({
        photoset_id: albumId,
        photo_id: photoId
      });
    }

    return res.status(200).json({
      success: true,
      photoId,
      albumId,
      message: 'Upload complete and assigned to album'
    });

  } catch (err) {
    console.error('Upload failed:', err?.response?.data || err.message);
    return res.status(500).json({
      error: 'Upload failed',
      detail: err?.response?.data || err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Uploader running on port ${PORT}`);
});

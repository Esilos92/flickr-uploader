import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import FlickrSdk from 'flickr-sdk';

const app = express();
app.use(express.json());

const flickr = new FlickrSdk(
  process.env.FLICKR_ACCESS_TOKEN,
  process.env.FLICKR_ACCESS_SECRET
);

app.post('/upload', async (req, res) => {
  const { dropboxUrl, title = 'Untitled', albumTitle, description = '' } = req.body;

  if (!dropboxUrl || !albumTitle) {
    return res.status(400).json({ error: 'Missing dropboxUrl or albumTitle' });
  }

  try {
    // Fetch image from Dropbox (or any direct-access URL)
    const imageResponse = await axios.get(dropboxUrl, { responseType: 'stream' });

    // Upload the photo to Flickr
    const uploadResponse = await flickr.upload({
      photo: imageResponse.data,
      title,
      description,
      is_public: 0, // always private
    });

    const photoId = uploadResponse.body.photoid._content;

    // Search for album by title
    const albums = await flickr.photosets.getList();
    let matchingAlbum = albums.body.photosets.photoset.find(
      (set) => set.title._content.toLowerCase() === albumTitle.toLowerCase()
    );

    // Create album if it doesn't exist
    if (!matchingAlbum) {
      const createdAlbum = await flickr.photosets.create({
        title: albumTitle,
        primary_photo_id: photoId,
      });
      matchingAlbum = createdAlbum.body.photoset;
    } else {
      // Add to existing album
      await flickr.photosets.addPhoto({
        photoset_id: matchingAlbum.id,
        photo_id: photoId,
      });
    }

    return res.status(200).json({
      success: true,
      photoId,
      albumId: matchingAlbum.id,
    });
  } catch (err) {
    console.error('Upload error:', err.message || err);
    return res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
});

app.all('*', (req, res) => {
  res.status(405).json({ error: 'Only POST requests allowed' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Uploader running on port ${PORT}`));

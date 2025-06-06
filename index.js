import express from "express";
import * as FlickrNS from "flickr-sdk";
import axios from "axios";
import FormData from "form-data";
import path from "path";

const app = express();
app.use(express.json());

const { Flickr } = FlickrNS;

const flickr = new Flickr(Flickr.OAuth.createPlugin(
  process.env.FLICKR_API_KEY,
  process.env.FLICKR_API_SECRET,
  process.env.FLICKR_ACCESS_TOKEN,
  process.env.FLICKR_ACCESS_SECRET
));

app.get("/", (req, res) => {
  res.send("✅ Flickr Upload API is running.");
});

async function getAlbumIdByTitle(title) {
  const res = await flickr.photosets.getList();
  const match = res.body.photosets.photoset.find(
    ps => ps.title._content === title
  );
  return match ? match.id : null;
}

async function createAlbum(title, primaryPhotoId) {
  const res = await flickr.photosets.create({
    title,
    primary_photo_id: primaryPhotoId
  });
  return res.body.photoset.id;
}

async function getAllPhotoIds() {
  const res = await flickr.people.getPhotos({
    user_id: "me",
    per_page: 500
  });
  return res.body.photos.photo.map(photo => photo.id);
}

async function uploadPhotoFromUrl(url, title, tags) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  const form = new FormData();
  form.append("title", title);
  form.append("tags", tags);
  form.append("photo", response.data, { filename: title });

  const uploadResponse = await axios.post("https://up.flickr.com/services/upload/", form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `OAuth oauth_consumer_key="${process.env.FLICKR_API_KEY}", oauth_token="${process.env.FLICKR_ACCESS_TOKEN}", oauth_signature_method="HMAC-SHA1", oauth_version="1.0"`
    }
  });

  const parsed = new URLSearchParams(uploadResponse.data);
  if (!parsed.get("photoid")) throw new Error("Upload failed");
  return parsed.get("photoid");
}

app.post("/upload", async (req, res) => {
  const { albumTitle, imageUrls, tags } = req.body;

  if (!Array.isArray(imageUrls)) {
    return res.status(400).json({ error: "imageUrls must be an array" });
  }

  try {
    const uploadedIds = [];
    const existingPhotoIds = await getAllPhotoIds();

    for (const imageUrl of imageUrls) {
      const title = path.basename(imageUrl);
      const photoId = await uploadPhotoFromUrl(imageUrl, title, tags);
      if (!existingPhotoIds.includes(photoId)) {
        uploadedIds.push(photoId);
      }
    }

    let albumId = await getAlbumIdByTitle(albumTitle);
    if (!albumId && uploadedIds.length > 0) {
      albumId = await createAlbum(albumTitle, uploadedIds[0]);
    }

    for (let i = 1; i < uploadedIds.length; i++) {
      await flickr.photosets.addPhoto({
        photoset_id: albumId,
        photo_id: uploadedIds[i]
      });
    }

    res.json({ success: true, uploadedIds, albumId });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default app;

// index.js — SDK-free Flickr album check + upload with homepage route

import axios from "axios";
import OAuth from "oauth-1.0a";
import crypto from "crypto";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import express from "express";

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send("✅ Flickr Upload API is running.");
});

const flickrKey = process.env.FLICKR_API_KEY;
const flickrSecret = process.env.FLICKR_API_SECRET;
const flickrAccessToken = process.env.FLICKR_ACCESS_TOKEN;
const flickrAccessSecret = process.env.FLICKR_ACCESS_SECRET;

const oauth = new OAuth({
  consumer: { key: flickrKey, secret: flickrSecret },
  signature_method: "HMAC-SHA1",
  hash_function(base_string, key) {
    return crypto.createHmac("sha1", key).update(base_string).digest("base64");
  },
});

async function getAlbumIdByTitle(title) {
  const url = "https://api.flickr.com/services/rest/";
  const params = {
    method: "flickr.photosets.getList",
    format: "json",
    nojsoncallback: 1,
  };
  const request_data = { url, method: "GET", data: params };
  const headers = oauth.toHeader(
    oauth.authorize(request_data, {
      key: flickrAccessToken,
      secret: flickrAccessSecret,
    })
  );
  const response = await axios.get(url, { headers, params });
  if (response.data.stat !== "ok") throw new Error("Failed to fetch album list.");
  const albums = response.data.photosets.photoset;
  const match = albums.find(ps => ps.title._content === title);
  return match ? match.id : null;
}

async function createAlbum(title, primaryPhotoId) {
  const url = "https://api.flickr.com/services/rest/";
  const params = {
    method: "flickr.photosets.create",
    title,
    primary_photo_id: primaryPhotoId,
    format: "json",
    nojsoncallback: 1,
  };
  const request_data = { url, method: "POST", data: params };
  const headers = oauth.toHeader(
    oauth.authorize(request_data, {
      key: flickrAccessToken,
      secret: flickrAccessSecret,
    })
  );
  const response = await axios.post(url, null, { headers, params });
  if (response.data.stat !== "ok") throw new Error("Failed to create album.");
  return response.data.photoset.id;
}

async function uploadPhotoFromUrl(url, title, tags) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  const form = new FormData();
  form.append("title", title);
  form.append("tags", tags);
  form.append("photo", response.data, { filename: title });

  const headers = form.getHeaders();
  const signedUrl = "https://up.flickr.com/services/upload/";
  const request_data = { url: signedUrl, method: "POST" };
  const oauthHeaders = oauth.toHeader(
    oauth.authorize(request_data, {
      key: flickrAccessToken,
      secret: flickrAccessSecret,
    })
  );

  const fullHeaders = { ...headers, ...oauthHeaders };
  const uploadResponse = await axios.post(signedUrl, form, { headers: fullHeaders });
  const parsed = new URLSearchParams(uploadResponse.data);
  if (!parsed.get("photoid")) throw new Error("Upload failed");
  return parsed.get("photoid");
}

app.post("/upload", async (req, res) => {
  const { albumTitle, imageUrls, tags } = req.body;
  try {
    const uploadedIds = [];
    for (const imageUrl of imageUrls) {
      const title = path.basename(imageUrl);
      const id = await uploadPhotoFromUrl(imageUrl, title, tags);
      uploadedIds.push(id);
    }

    let albumId = await getAlbumIdByTitle(albumTitle);
    if (!albumId) {
      albumId = await createAlbum(albumTitle, uploadedIds[0]);
    }

    for (let i = 1; i < uploadedIds.length; i++) {
      await axios.post("https://api.flickr.com/services/rest/", null, {
        params: {
          method: "flickr.photosets.addPhoto",
          photoset_id: albumId,
          photo_id: uploadedIds[i],
          format: "json",
          nojsoncallback: 1,
        },
        headers: oauth.toHeader(
          oauth.authorize(
            {
              url: "https://api.flickr.com/services/rest/",
              method: "POST",
              data: {
                method: "flickr.photosets.addPhoto",
                photoset_id: albumId,
                photo_id: uploadedIds[i],
              },
            },
            {
              key: flickrAccessToken,
              secret: flickrAccessSecret,
            }
          )
        ),
      });
    }

    res.json({ success: true, albumId });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default app;

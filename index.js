const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const crypto = require("crypto");
const OAuth = require("oauth-1.0a");

const app = express();
app.use(express.json());

const flickrApiKey = process.env.FLICKR_API_KEY;
const flickrApiSecret = process.env.FLICKR_API_SECRET;
const flickrAccessToken = process.env.FLICKR_ACCESS_TOKEN;
const flickrAccessSecret = process.env.FLICKR_ACCESS_SECRET;

const oauth = OAuth({
  consumer: { key: flickrApiKey, secret: flickrApiSecret },
  signature_method: "HMAC-SHA1",
  hash_function(base_string, key) {
    return crypto.createHmac("sha1", key).update(base_string).digest("base64");
  },
});

async function uploadPhotoFromUrl(photoUrl, title = "Untitled") {
  const form = new FormData();
  form.append("title", title);
  form.append("photo", await axios.get(photoUrl, { responseType: "stream" }).then(res => res.data));

  const url = "https://up.flickr.com/services/upload/";
  const authHeaders = oauth.toHeader(
    oauth.authorize(
      {
        url,
        method: "POST",
      },
      {
        key: flickrAccessToken,
        secret: flickrAccessSecret,
      }
    )
  );

  const response = await axios.post(url, form, {
    headers: {
      ...form.getHeaders(),
      ...authHeaders,
    },
  });

  const match = response.data.match(/<photoid>(\d+)<\/photoid>/);
  if (!match) throw new Error("Failed to extract photo ID.");
  return match[1];
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

  const request_data = {
    url,
    method: "POST",
    data: params,
  };

  const headers = oauth.toHeader(
    oauth.authorize(request_data, {
      key: flickrAccessToken,
      secret: flickrAccessSecret,
    })
  );

  const response = await axios.post(url, new URLSearchParams(params), {
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (response.data.stat !== "ok") throw new Error("Failed to create album.");
  return response.data.photoset.id;
}

async function addPhotoToAlbum(photosetId, photoId) {
  const url = "https://api.flickr.com/services/rest/";
  const params = {
    method: "flickr.photosets.addPhoto",
    photoset_id: photosetId,
    photo_id: photoId,
    format: "json",
    nojsoncallback: 1,
  };

  const request_data = {
    url,
    method: "POST",
    data: params,
  };

  const headers = oauth.toHeader(
    oauth.authorize(request_data, {
      key: flickrAccessToken,
      secret: flickrAccessSecret,
    })
  );

  const response = await axios.post(url, new URLSearchParams(params), {
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (response.data.stat !== "ok") throw new Error("Failed to add photo to album.");
}

app.post("/", async (req, res) => {
  try {
    const { folderName, imageUrls } = req.body;
    if (!folderName || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).send("Missing folderName or imageUrls.");
    }

    const uploadedIds = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const photoId = await uploadPhotoFromUrl(imageUrls[i], `${folderName} – Photo ${i + 1}`);
      uploadedIds.push(photoId);
    }

    const albumId = await createAlbum(folderName, uploadedIds[0]);
    for (let i = 1; i < uploadedIds.length; i++) {
      await addPhotoToAlbum(albumId, uploadedIds[i]);
    }

    res.status(200).send({ status: "Upload complete", albumId, photos: uploadedIds });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Upload failed.");
  }
});

app.listen(3000, () => {
  console.log("Uploader live on port 3000");
});

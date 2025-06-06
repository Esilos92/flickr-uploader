// Minimal working version for Vercel deployment
module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'ok', 
      message: 'Flickr uploader is running',
      timestamp: new Date().toISOString()
    });
  }

  // Only handle POST requests for upload
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Basic validation
    const { dropboxUrl, imageUrl, albumTitle, albumPath } = req.body || {};
    
    if (!dropboxUrl && !imageUrl) {
      return res.status(400).json({ 
        error: 'Missing required field: dropboxUrl or imageUrl' 
      });
    }

    if (!albumTitle && !albumPath) {
      return res.status(400).json({ 
        error: 'Missing required field: albumTitle or albumPath' 
      });
    }

    // Check environment variables
    const requiredEnvVars = [
      'FLICKR_API_KEY',
      'FLICKR_API_SECRET', 
      'FLICKR_ACCESS_TOKEN',
      'FLICKR_ACCESS_SECRET',
      'FLICKR_USER_ID'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      return res.status(500).json({ 
        error: 'Missing environment variables',
        missing: missingVars
      });
    }

    // For now, just return success to test deployment
    return res.status(200).json({
      message: 'Upload endpoint working',
      received: {
        url: dropboxUrl || imageUrl,
        album: albumTitle || albumPath,
        timestamp: new Date().toISOString()
      },
      note: 'Flickr integration will be added once deployment is successful'
    });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
};

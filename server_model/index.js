const express = require('express');
const https = require('https');
const app = express();
const allroutes = require('./routes/AllRoutes');
const mongoose = require('mongoose');
const { reportsModel } = require('./schemas/allSchemas');
const cors = require('cors');
const dotenv = require("dotenv");
dotenv.config();
app.use(express.json());
const pdfParse = require('pdf-parse');

const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const bodyParser = require("body-parser");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");


dotenv.config();


app.use(bodyParser.json());
app.use(cors());

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

// Chatbot endpoint
app.post('/diagnose', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).send("Prompt is required");
  }
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    res.send(text);
  } catch (error) {
    console.log(error);
    res.status(500).send("Failed to generate content");
  }
});

// Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  const filePath = path.join(__dirname, req.file.path);

  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    // Extract text from PDF
    const extractedText = data.text;
    console.log("Extracted Text:", extractedText);

    // Send the extracted text to Gemini to generate a nested dictionary
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `${extractedText} Generate a nested dictionary from the text where first give the patient details then give a dictionary where the primary keys are test categories (e.g., Blood Group, CBC) and each category contains a dictionary of test names as keys and their values as the test result along with their units as a single string without the range. ignore non whitespaces`;
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const generatedText = response.text();

      console.log("Generated Text:", generatedText);

      // Extract JSON dictionary from the generated text
      let dictionaryString = generatedText.substring(generatedText.indexOf('{'), generatedText.lastIndexOf('}') + 1);

      // Clean the JSON string
      dictionaryString = dictionaryString.replace(/`/g, '').replace(/[\n\r]/g, '').trim();

      console.log("Cleaned Dictionary String:", dictionaryString);

      // Attempt to parse the JSON string
      let dictionary;
      try {
        dictionary = JSON.parse(dictionaryString);
      } catch (parseError) {
        console.log("First parsing error:", parseError);

        // Further cleaning if initial parse fails
        dictionaryString = dictionaryString.replace(/[^a-zA-Z0-9:{}\[\],\"\' ]/g, '');
        console.log("Further cleaned Dictionary String:", dictionaryString);

        try {
          dictionary = JSON.parse(dictionaryString);
        } catch (finalParseError) {
          console.log("Final parsing error:", finalParseError);

          // Additional manual extraction and parsing
          const patientDetailsStart = dictionaryString.indexOf('{');
          const testResultsStart = dictionaryString.indexOf('testresults');

          if (patientDetailsStart !== -1 && testResultsStart !== -1) {
            const patientDetailsString = dictionaryString.substring(patientDetailsStart, testResultsStart).trim();
            const testResultsString = dictionaryString.substring(testResultsStart + 'testresults'.length).trim();

            try {
              const patientDetails = JSON.parse(patientDetailsString);
              const testResults = JSON.parse(testResultsString);

              dictionary = {
                patientdetails: patientDetails,
                testresults: testResults,
              };
            } catch (manualParseError) {
              console.log("Manual parsing error:", manualParseError);
              return res.status(500).send("Failed to parse generated dictionary");
            }
          } else {
            return res.status(500).send("Failed to parse generated dictionary");
          }
        }
      }

      console.log("Generated Dictionary:", dictionary);

      // Respond with the generated dictionary
      res.json({ details: dictionary });
    } catch (error) {
      console.log(error);
      res.status(500).send("Failed to generate content");
    }
  } catch (error) {
    console.error("Error processing PDF:", error);

    // Clean up uploaded file in case of error
    fs.unlinkSync(filePath);

    res.status(500).send('Error processing PDF');
  }
});

// Save endpoint
app.post("/save", async (req, res) => {
  const { userId, week, ...reportData } = req.body;
  console.log('Received data to save:', req.body);

  if (!userId || !week || !reportData) {
    return res.status(400).send("User ID, week number, and report data are required");
  }

  try {
    const report = new reportsModel({ userId, week, reportData });
    await report.save();
    res.send({ success: true, message: "Data saved successfully" });
  } catch (error) {
    console.error('Error saving data:', error);
    res.status(500).send('Internal Server Error: Failed to save data');
  }
});

let db = async () => { 
  try{ 
      console.log(process.env.DBURI);
      await mongoose.connect(process.env.DBURI);
      console.log("connected to database");
  }
  catch(err) {
      console.log('error connecting');
  }
}
db();

app.use('/api', allroutes);
const port = 8080;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

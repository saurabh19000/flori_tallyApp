import com.sap.gateway.ip.core.customdev.util.Message
import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import groovy.util.XmlSlurper

/**
 * PRODUCTION ACCURACY SCRIPT 3.0
 * 
 * Precisely extracts every unique document from the SAP Data Store 
 * while preventing duplicates and capturing the real SAP Message ID.
 */
def Message processData(Message message) {
    // 1. Strict Reader access for Streaming Compliance
    java.io.Reader reader = message.getBody(java.io.Reader.class)
    
    if (reader == null) {
        message.setBody("[]")
        message.setHeader("Content-Type", "application/json")
        return message
    }

    def entries = []
    try {
        // 2. Parse the Data Store XML wrapper
        def xml = new XmlSlurper().parse(reader)
        
        // 3. Precision Extraction: Iterate ONLY through direct <message> nodes
        // This prevents the "Double Counting" bug caused by depthFirst()
        xml.message.each { msg ->
            String sapId = msg.@id.text() // Extract the REAL SAP ID attribute
            
            // Handle different SAP Data Store response formats (Value node vs direct)
            def targetNode = msg.entry.value.size() > 0 ? msg.entry.value : msg
            String rawContent = targetNode.text()?.trim()

            if (rawContent && rawContent.length() > 2) {
                def parsedData = null
                
                // --- DATA TRANSLATOR ---
                // Detect JSON (CDATA or raw)
                if (rawContent.startsWith("{") || rawContent.startsWith("[")) {
                    try {
                        parsedData = new JsonSlurper().parseText(rawContent)
                    } catch (Exception e) { /* Not valid JSON after all */ }
                }
                
                // Fallback to XML-to-Map (for Pure XML storage)
                if (parsedData == null && rawContent.contains("<")) {
                    try {
                        def nestedXml = new XmlSlurper().parseText(rawContent)
                        parsedData = xmlToMap(nestedXml)
                    } catch (Exception e) { /* Not valid XML */ }
                }

                // Final Fallback: Raw Text
                if (parsedData == null) {
                    parsedData = [rawData: rawContent, type: "Unstructured"]
                }

                // 4. INTEGRITY BOND: Capture the absolute accurate SAP ID
                if (parsedData instanceof Map) {
                    // PRIORITIZE: The original ID inside your data (AGoibEmA...)
                    // FALLBACK: The Data Store ID only if the original is missing
                    String actualId = parsedData.cpiMessageId ?: parsedData.messageId || parsedData.syncId || sapId
                    
                    parsedData.syncId = actualId
                    parsedData.cpiMessageId = actualId
                }
                
                entries.add(parsedData)
            }
        }
    } catch (Exception e) {
        message.setProperty("Ingestion_Integrity_Error", e.getMessage())
    } finally {
        if (reader != null) {
            try { reader.close() } catch (Exception e) { }
        }
    }

    // 5. Output clean JSON array for the Dashboard
    message.setBody(JsonOutput.toJson(entries))
    message.setHeader("Content-Type", "application/json")
    return message
}

/**
 * Helper: Converts any XML structure into a clean JSON-compatible Map
 */
def Map xmlToMap(node) {
    def map = [:]
    node.children().each { child ->
        def key = child.name()
        def value = child.children().size() > 0 ? xmlToMap(child) : child.text()
        if (map.containsKey(key)) {
            if (map[key] instanceof List) map[key].add(value)
            else map[key] = [map[key], value]
        } else {
            map[key] = value
        }
    }
    return map
}

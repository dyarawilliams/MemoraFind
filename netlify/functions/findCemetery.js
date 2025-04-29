const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

async function findCemetery(memorial_id) {
  // List of cemetery tables to check
  // These should be the names of the views in your Supabase database
  // You can also use the table names if you prefer
  // Note: Make sure these names match the actual table/view names in your Supabase database

  const cemeteryViews = [
    "bcmg_data_formatted_2",
    "capernaum_data_formatted_2",
    "honeyford_data_formatted_2",
  ];

  for (const cemeteryView of cemeteryViews) {
    const { data, error } = await supabase
      .from(cemeteryView)
      .select("memorial_id")
      .eq("memorial_id", memorial_id);
    
    if (data && data.length > 0) {
      return cemeteryView;
    }

    if (error) {
      console.error(`Error fetching from ${cemeteryView}:`, error);
      throw new Error('An error occurred while querying the database.');
    }
  }
  return null;
}

module.exports = { findCemetery };

# Chart Data Format Documentation

The AI Insights API returns ready-to-use chart configurations that can be directly plugged into popular charting libraries like Chart.js, Recharts, or any other visualization library.

## Overview

Each insight response includes a `charts` array with multiple pre-configured chart objects. Each chart specifies:
- **Type**: The chart type (pie, bar, line, heatmap, etc.)
- **Title**: Display title for the chart
- **Description**: What the chart shows
- **Data**: Ready-to-use data in a standard format

## Chart Types Included

### 1. Pie Chart - Activity Distribution by Category
Shows the breakdown of activities across different categories.

```json
{
  "type": "pie",
  "title": "Activity Distribution by Category",
  "description": "Breakdown of activities across different categories",
  "data": {
    "labels": ["agent", "call", "chat", "connector", "chat_agent"],
    "values": [45, 67, 32, 8, 4],
    "colors": ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"]
  }
}
```

**Usage with Chart.js:**
```javascript
const chartData = insights.charts.find(c => c.type === 'pie');

new Chart(ctx, {
  type: 'pie',
  data: {
    labels: chartData.data.labels,
    datasets: [{
      data: chartData.data.values,
      backgroundColor: chartData.data.colors
    }]
  },
  options: {
    plugins: {
      title: {
        display: true,
        text: chartData.title
      }
    }
  }
});
```

### 2. Bar Chart - Activity Count by Category
Comparison of activity volumes across categories.

```json
{
  "type": "bar",
  "title": "Activity Count by Category",
  "description": "Comparison of activity volumes across categories",
  "data": {
    "labels": ["agent", "call", "chat", "connector", "chat_agent"],
    "datasets": [{
      "label": "Activity Count",
      "values": [45, 67, 32, 8, 4],
      "backgroundColor": "#3B82F6"
    }]
  }
}
```

**Usage with Chart.js:**
```javascript
const chartData = insights.charts.find(c => c.type === 'bar');

new Chart(ctx, {
  type: 'bar',
  data: {
    labels: chartData.data.labels,
    datasets: chartData.data.datasets.map(ds => ({
      label: ds.label,
      data: ds.values,
      backgroundColor: ds.backgroundColor
    }))
  },
  options: {
    plugins: {
      title: {
        display: true,
        text: chartData.title
      }
    }
  }
});
```

### 3. Horizontal Bar Chart - Top 10 Activity Types
Shows the most common operations performed.

```json
{
  "type": "horizontalBar",
  "title": "Top 10 Activity Types",
  "description": "Most common operations performed",
  "data": {
    "labels": [
      "web call created",
      "agent created",
      "agent updated",
      "chat created",
      "chat message sent"
    ],
    "datasets": [{
      "label": "Count",
      "values": [45, 23, 20, 18, 12],
      "backgroundColor": "#10B981"
    }]
  }
}
```

**Usage with Chart.js:**
```javascript
const chartData = insights.charts.find(c => c.type === 'horizontalBar');

new Chart(ctx, {
  type: 'bar',
  data: {
    labels: chartData.data.labels,
    datasets: chartData.data.datasets.map(ds => ({
      label: ds.label,
      data: ds.values,
      backgroundColor: ds.backgroundColor
    }))
  },
  options: {
    indexAxis: 'y', // This makes it horizontal
    plugins: {
      title: {
        display: true,
        text: chartData.title
      }
    }
  }
});
```

### 4. Line Chart - Activity Timeline
Daily activity trend over the past week.

```json
{
  "type": "line",
  "title": "Activity Timeline (Last 7 Days)",
  "description": "Daily activity trend over the past week",
  "data": {
    "labels": ["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11", "2024-01-12", "2024-01-13", "2024-01-14"],
    "datasets": [{
      "label": "Total Activities",
      "values": [12, 18, 25, 30, 22, 28, 21],
      "borderColor": "#3B82F6",
      "backgroundColor": "rgba(59, 130, 246, 0.1)",
      "fill": true
    }]
  }
}
```

**Usage with Chart.js:**
```javascript
const chartData = insights.charts.find(c => c.title.includes('Timeline'));

new Chart(ctx, {
  type: 'line',
  data: {
    labels: chartData.data.labels,
    datasets: chartData.data.datasets.map(ds => ({
      label: ds.label,
      data: ds.values,
      borderColor: ds.borderColor,
      backgroundColor: ds.backgroundColor,
      fill: ds.fill
    }))
  },
  options: {
    plugins: {
      title: {
        display: true,
        text: chartData.title
      }
    }
  }
});
```

### 5. Multi-line Chart - Activity Trends by Category
Compare activity trends across different categories over time.

```json
{
  "type": "line",
  "title": "Activity Trends by Category",
  "description": "Compare activity trends across different categories",
  "data": {
    "labels": ["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11", "2024-01-12"],
    "datasets": [
      {
        "label": "agent",
        "values": [5, 8, 10, 12, 10],
        "borderColor": "#3B82F6",
        "fill": false
      },
      {
        "label": "call",
        "values": [10, 12, 15, 18, 12],
        "borderColor": "#10B981",
        "fill": false
      },
      {
        "label": "chat",
        "values": [3, 5, 7, 9, 8],
        "borderColor": "#F59E0B",
        "fill": false
      }
    ]
  }
}
```

**Usage with Chart.js:**
```javascript
const chartData = insights.charts.find(c => c.title.includes('Trends by Category'));

new Chart(ctx, {
  type: 'line',
  data: {
    labels: chartData.data.labels,
    datasets: chartData.data.datasets.map(ds => ({
      label: ds.label,
      data: ds.values,
      borderColor: ds.borderColor,
      fill: ds.fill
    }))
  },
  options: {
    plugins: {
      title: {
        display: true,
        text: chartData.title
      }
    }
  }
});
```

### 6. Heatmap - Activity by Day and Hour
Shows when activities occur throughout the week (day of week vs hour of day).

```json
{
  "type": "heatmap",
  "title": "Activity Heatmap (Day vs Hour)",
  "description": "When activities occur throughout the week",
  "data": [
    { "day": "Monday", "hour": 0, "value": 0 },
    { "day": "Monday", "hour": 1, "value": 0 },
    { "day": "Monday", "hour": 9, "value": 5 },
    { "day": "Monday", "hour": 10, "value": 8 },
    { "day": "Monday", "hour": 14, "value": 12 },
    // ... more data points
  ]
}
```

**Usage with custom heatmap library:**
```javascript
const heatmapData = insights.charts.find(c => c.type === 'heatmap');

// Transform for your heatmap library
const transformedData = heatmapData.data.reduce((acc, item) => {
  if (!acc[item.day]) acc[item.day] = {};
  acc[item.day][item.hour] = item.value;
  return acc;
}, {});

// Use with your preferred heatmap visualization
```

## Complete API Response Example

```json
{
  "success": true,
  "message": "Insights generated successfully",
  "data": {
    "insights": {
      "summary": "Activity shows healthy growth...",
      "trends": [...],
      "recommendations": [...],
      "keyMetrics": {...},
      "alerts": [...]
    },
    "charts": [
      {
        "type": "pie",
        "title": "Activity Distribution by Category",
        "description": "Breakdown of activities across different categories",
        "data": {
          "labels": ["agent", "call", "chat", "connector"],
          "values": [45, 67, 32, 8],
          "colors": ["#3B82F6", "#10B981", "#F59E0B", "#EF4444"]
        }
      },
      {
        "type": "bar",
        "title": "Activity Count by Category",
        "description": "Comparison of activity volumes across categories",
        "data": {
          "labels": ["agent", "call", "chat", "connector"],
          "datasets": [{
            "label": "Activity Count",
            "values": [45, 67, 32, 8],
            "backgroundColor": "#3B82F6"
          }]
        }
      },
      {
        "type": "line",
        "title": "Activity Timeline (Last 7 Days)",
        "description": "Daily activity trend over the past week",
        "data": {
          "labels": ["2024-01-08", "2024-01-09", "2024-01-10"],
          "datasets": [{
            "label": "Total Activities",
            "values": [12, 18, 25],
            "borderColor": "#3B82F6",
            "backgroundColor": "rgba(59, 130, 246, 0.1)",
            "fill": true
          }]
        }
      }
      // ... more charts
    ],
    "activitiesAnalyzed": 156,
    "timeRange": {
      "start": "2024-01-08T12:00:00.000Z",
      "end": "2024-01-15T12:00:00.000Z",
      "days": 7
    },
    "generatedAt": "2024-01-15T12:00:00.000Z",
    "model": "gpt-4o-mini",
    "cached": false
  }
}
```

## React Example

Using the charts data in a React component:

```jsx
import { Chart as ChartJS } from 'chart.js/auto';
import { Line, Bar, Pie } from 'react-chartjs-2';

function DashboardCharts({ insights }) {
  const charts = insights.charts;

  // Pie Chart
  const pieChart = charts.find(c => c.type === 'pie');
  const pieData = {
    labels: pieChart.data.labels,
    datasets: [{
      data: pieChart.data.values,
      backgroundColor: pieChart.data.colors
    }]
  };

  // Bar Chart
  const barChart = charts.find(c => c.type === 'bar');
  const barData = {
    labels: barChart.data.labels,
    datasets: barChart.data.datasets.map(ds => ({
      label: ds.label,
      data: ds.values,
      backgroundColor: ds.backgroundColor
    }))
  };

  // Line Chart
  const lineChart = charts.find(c => c.type === 'line' && c.title.includes('Timeline'));
  const lineData = {
    labels: lineChart.data.labels,
    datasets: lineChart.data.datasets.map(ds => ({
      label: ds.label,
      data: ds.values,
      borderColor: ds.borderColor,
      backgroundColor: ds.backgroundColor,
      fill: ds.fill
    }))
  };

  return (
    <div className="dashboard-charts">
      <div className="chart-container">
        <h3>{pieChart.title}</h3>
        <p>{pieChart.description}</p>
        <Pie data={pieData} />
      </div>

      <div className="chart-container">
        <h3>{barChart.title}</h3>
        <p>{barChart.description}</p>
        <Bar data={barData} />
      </div>

      <div className="chart-container">
        <h3>{lineChart.title}</h3>
        <p>{lineChart.description}</p>
        <Line data={lineData} />
      </div>
    </div>
  );
}

export default DashboardCharts;
```

## Recharts Example

Using with Recharts library:

```jsx
import { PieChart, Pie, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend } from 'recharts';

function RechartsExample({ insights }) {
  const pieChart = insights.charts.find(c => c.type === 'pie');
  const pieData = pieChart.data.labels.map((label, i) => ({
    name: label,
    value: pieChart.data.values[i]
  }));

  const barChart = insights.charts.find(c => c.type === 'bar');
  const barData = barChart.data.labels.map((label, i) => ({
    name: label,
    value: barChart.data.datasets[0].values[i]
  }));

  const lineChart = insights.charts.find(c => c.type === 'line' && c.title.includes('Timeline'));
  const lineData = lineChart.data.labels.map((label, i) => ({
    date: label,
    activities: lineChart.data.datasets[0].values[i]
  }));

  return (
    <div>
      <PieChart width={400} height={400}>
        <Pie data={pieData} dataKey="value" nameKey="name" fill="#8884d8" label />
        <Tooltip />
      </PieChart>

      <BarChart width={600} height={300} data={barData}>
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="value" fill="#3B82F6" />
      </BarChart>

      <LineChart width={600} height={300} data={lineData}>
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Line type="monotone" dataKey="activities" stroke="#3B82F6" />
      </LineChart>
    </div>
  );
}
```

## Color Palette

Standard colors used across charts:
- **Blue** `#3B82F6` - Primary, Agent activities
- **Green** `#10B981` - Success, Call activities
- **Amber** `#F59E0B` - Warning, Chat activities
- **Red** `#EF4444` - Error, Critical activities
- **Purple** `#8B5CF6` - Secondary, Connector activities

## Chart Library Compatibility

The data format is compatible with:
- ✅ **Chart.js** (v3+)
- ✅ **Recharts**
- ✅ **Victory Charts**
- ✅ **Nivo**
- ✅ **ApexCharts**
- ✅ **D3.js** (with minor transformation)
- ✅ Most other JavaScript charting libraries

## Best Practices

1. **Iterate through charts array** to render all available charts
2. **Use chart type** to determine which component to render
3. **Include titles and descriptions** for better UX
4. **Handle empty data** gracefully
5. **Make charts responsive** for different screen sizes
6. **Add interactivity** (tooltips, legends, filters)

## Example: Dynamic Chart Renderer

```jsx
function ChartRenderer({ chart }) {
  switch(chart.type) {
    case 'pie':
      return <PieChartComponent chart={chart} />;
    case 'bar':
      return <BarChartComponent chart={chart} />;
    case 'horizontalBar':
      return <HorizontalBarChartComponent chart={chart} />;
    case 'line':
      return <LineChartComponent chart={chart} />;
    case 'heatmap':
      return <HeatmapComponent chart={chart} />;
    default:
      return null;
  }
}

function Dashboard({ insights }) {
  return (
    <div className="dashboard">
      {insights.charts.map((chart, index) => (
        <div key={index} className="chart-card">
          <h3>{chart.title}</h3>
          <p>{chart.description}</p>
          <ChartRenderer chart={chart} />
        </div>
      ))}
    </div>
  );
}
```

This format ensures you can easily create professional visualizations with minimal code!
